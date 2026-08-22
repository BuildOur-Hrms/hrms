import type { RequestContext } from "@/lib/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { invalidateSettingsCache } from "@/modules/settings/service";

import type {
  CreateDepartmentInput,
  CreateDesignationInput,
  CreateLocationInput,
  UpdateCompanyInput,
  UpdateDepartmentInput,
  UpdateDesignationInput,
  UpdateLocationInput,
} from "./validators";

/**
 * Company, locations, departments, designations.
 *
 * These are the org skeleton every employee record hangs off, which is why
 * deletes are soft and guarded: removing a department that people are still
 * assigned to would orphan them, so it is refused with a 409 rather than
 * cascaded.
 */

function actor(ctx: RequestContext): EventActor {
  return {
    userId: ctx.userId,
    companyId: ctx.companyId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    db: ctx.db,
  };
}

/** Diff helper so audit rows record what actually changed, not the whole row. */
function changedFields<T extends object>(before: T, after: Partial<T>): string[] {
  return Object.keys(after).filter(
    (key) =>
      after[key as keyof T] !== undefined && after[key as keyof T] !== before[key as keyof T],
  );
}

// ─────────────────────────────────────────────── company

export async function getCompany(ctx: RequestContext) {
  const company = await ctx.db.company.findFirst({
    where: { id: ctx.companyId },
    select: {
      id: true,
      name: true,
      legalName: true,
      slug: true,
      logoKey: true,
      address: true,
      contactEmail: true,
      timezone: true,
      currency: true,
      status: true,
      createdAt: true,
    },
  });
  if (!company) throw new NotFoundError("Company");
  return company;
}

export async function updateCompany(ctx: RequestContext, input: UpdateCompanyInput) {
  const before = await getCompany(ctx);

  const updated = await ctx.db.company.update({
    where: { id: ctx.companyId },
    data: input,
    select: {
      id: true,
      name: true,
      legalName: true,
      slug: true,
      address: true,
      contactEmail: true,
      timezone: true,
      currency: true,
    },
  });

  // Timezone and currency are also exposed as settings; drop the cached copy.
  invalidateSettingsCache(ctx.companyId);

  await emit("org.company_updated", { changedFields: changedFields(before, input) }, actor(ctx));
  return updated;
}

// ─────────────────────────────────────────────── locations

export async function listLocations(ctx: RequestContext) {
  return ctx.db.location.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      timezone: true,
      _count: { select: { employees: { where: { deletedAt: null } } } },
    },
  });
}

export async function createLocation(ctx: RequestContext, input: CreateLocationInput) {
  const location = await ctx.db.location.create({
    data: {
      companyId: ctx.companyId,
      name: input.name,
      code: input.code,
      address: input.address ?? null,
      timezone: input.timezone ?? null,
    },
    select: { id: true, name: true, code: true, address: true, timezone: true },
  });

  await emit("org.location_changed", { locationId: location.id, action: "created" }, actor(ctx));
  return location;
}

export async function updateLocation(ctx: RequestContext, id: string, input: UpdateLocationInput) {
  await mustExist(ctx, "location", id);

  const location = await ctx.db.location.update({
    where: { id },
    data: input,
    select: { id: true, name: true, code: true, address: true, timezone: true },
  });

  await emit("org.location_changed", { locationId: id, action: "updated" }, actor(ctx));
  return location;
}

export async function deleteLocation(ctx: RequestContext, id: string) {
  await mustExist(ctx, "location", id);

  const inUse = await ctx.db.employee.count({ where: { locationId: id } });
  if (inUse > 0) {
    throw new ConflictError(
      `${inUse} employee${inUse === 1 ? " is" : "s are"} still assigned to this location`,
    );
  }

  await ctx.db.location.update({ where: { id }, data: { deletedAt: new Date() } });
  await emit("org.location_changed", { locationId: id, action: "deleted" }, actor(ctx));
}

// ─────────────────────────────────────────────── departments

export async function listDepartments(ctx: RequestContext) {
  return ctx.db.department.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      headEmployeeId: true,
      headEmployee: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { employees: { where: { deletedAt: null } } } },
    },
  });
}

export async function createDepartment(ctx: RequestContext, input: CreateDepartmentInput) {
  if (input.headEmployeeId) await mustExist(ctx, "employee", input.headEmployeeId);

  const department = await ctx.db.department.create({
    data: {
      companyId: ctx.companyId,
      name: input.name,
      code: input.code,
      headEmployeeId: input.headEmployeeId ?? null,
    },
    select: { id: true, name: true, code: true, headEmployeeId: true },
  });

  await emit(
    "org.department_changed",
    { departmentId: department.id, action: "created" },
    actor(ctx),
  );
  return department;
}

export async function updateDepartment(
  ctx: RequestContext,
  id: string,
  input: UpdateDepartmentInput,
) {
  await mustExist(ctx, "department", id);
  if (input.headEmployeeId) await mustExist(ctx, "employee", input.headEmployeeId);

  const department = await ctx.db.department.update({
    where: { id },
    data: input,
    select: { id: true, name: true, code: true, headEmployeeId: true },
  });

  await emit("org.department_changed", { departmentId: id, action: "updated" }, actor(ctx));
  return department;
}

export async function deleteDepartment(ctx: RequestContext, id: string) {
  await mustExist(ctx, "department", id);

  const inUse = await ctx.db.employee.count({ where: { departmentId: id } });
  if (inUse > 0) {
    throw new ConflictError(
      `${inUse} employee${inUse === 1 ? " is" : "s are"} still in this department`,
    );
  }

  await ctx.db.department.update({ where: { id }, data: { deletedAt: new Date() } });
  await emit("org.department_changed", { departmentId: id, action: "deleted" }, actor(ctx));
}

// ─────────────────────────────────────────────── designations

export async function listDesignations(ctx: RequestContext) {
  return ctx.db.designation.findMany({
    orderBy: [{ level: "asc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      code: true,
      level: true,
      _count: { select: { employees: { where: { deletedAt: null } } } },
    },
  });
}

export async function createDesignation(ctx: RequestContext, input: CreateDesignationInput) {
  const designation = await ctx.db.designation.create({
    data: {
      companyId: ctx.companyId,
      title: input.title,
      code: input.code,
      level: input.level,
    },
    select: { id: true, title: true, code: true, level: true },
  });

  await emit(
    "org.designation_changed",
    { designationId: designation.id, action: "created" },
    actor(ctx),
  );
  return designation;
}

export async function updateDesignation(
  ctx: RequestContext,
  id: string,
  input: UpdateDesignationInput,
) {
  await mustExist(ctx, "designation", id);

  const designation = await ctx.db.designation.update({
    where: { id },
    data: input,
    select: { id: true, title: true, code: true, level: true },
  });

  await emit("org.designation_changed", { designationId: id, action: "updated" }, actor(ctx));
  return designation;
}

export async function deleteDesignation(ctx: RequestContext, id: string) {
  await mustExist(ctx, "designation", id);

  const inUse = await ctx.db.employee.count({ where: { designationId: id } });
  if (inUse > 0) {
    throw new ConflictError(
      `${inUse} employee${inUse === 1 ? " holds" : "s hold"} this designation`,
    );
  }

  await ctx.db.designation.update({ where: { id }, data: { deletedAt: new Date() } });
  await emit("org.designation_changed", { designationId: id, action: "deleted" }, actor(ctx));
}

// ─────────────────────────────────────────────── shared

/**
 * Existence check inside tenant scope. A row belonging to another company is
 * indistinguishable from one that does not exist, which is the point: 404
 * rather than 403 keeps the API from confirming that an id is real somewhere
 * else (docs/08-api.md §1).
 */
async function mustExist(
  ctx: RequestContext,
  entity: "location" | "department" | "designation" | "employee",
  id: string,
): Promise<void> {
  const found = await (async () => {
    switch (entity) {
      case "location":
        return ctx.db.location.findFirst({ where: { id }, select: { id: true } });
      case "department":
        return ctx.db.department.findFirst({ where: { id }, select: { id: true } });
      case "designation":
        return ctx.db.designation.findFirst({ where: { id }, select: { id: true } });
      case "employee":
        return ctx.db.employee.findFirst({ where: { id }, select: { id: true } });
    }
  })();

  if (!found) {
    throw new NotFoundError(entity.charAt(0).toUpperCase() + entity.slice(1));
  }
}

/** Options for the pickers on the employee form, in one round trip. */
export async function orgOptions(ctx: RequestContext) {
  const [departments, designations, locations] = await Promise.all([
    ctx.db.department.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    ctx.db.designation.findMany({
      orderBy: [{ level: "asc" }, { title: "asc" }],
      select: { id: true, title: true, code: true, level: true },
    }),
    ctx.db.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
  ]);

  return {
    departments,
    designations,
    locations,
    /** The employee form uses this to explain why it cannot open yet. */
    ready: departments.length > 0 && designations.length > 0 && locations.length > 0,
  };
}
