import type { RequestContext } from "@/lib/context";
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope, type Scope } from "@/lib/permissions";
import { fromDateOnly } from "@/lib/utils";
import { inviteUser } from "@/modules/auth/service";

import { employeeSelect, resolveVisibility, toEmployeeDto, type EmployeeRow } from "./dto";
import type {
  ChangeStatusInput,
  CreateEmployeeInput,
  EmergencyContactInput,
  ListEmployeesInput,
  UpdateEmployeeInput,
  UpdateOwnProfileInput,
} from "./validators";

/**
 * Employee master data.
 *
 * Three things are enforced here rather than at the route:
 *  1. Scope — own / team / company, derived from the caller's permissions.
 *  2. Object-level access — a manager may only act on their direct reports,
 *     and "not yours" is reported as 404, never 403.
 *  3. Lifecycle — status moves along a fixed state machine; exited is final.
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

/**
 * Allowed status transitions (docs/07-workflows-and-automation.md).
 *
 * `exited` is terminal on purpose: a returning employee is a new record with
 * a new join date, not a resurrected one, so their history stays truthful.
 */
const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  onboarding: ["active", "exited"],
  active: ["on_notice", "exited"],
  on_notice: ["active", "exited"],
  exited: [],
};

// ─────────────────────────────────────────────── scope

interface EmployeeScope {
  scope: Scope;
  /** Prisma filter that narrows a query to what the caller may see. */
  filter: Record<string, unknown>;
}

function employeeScope(ctx: RequestContext): EmployeeScope {
  const scope = resolveScope(ctx, "employee");

  switch (scope) {
    case "all":
      return { scope, filter: {} };
    case "team":
      // A manager sees their direct reports and their own record.
      return {
        scope,
        filter: ctx.employeeId
          ? { OR: [{ managerId: ctx.employeeId }, { id: ctx.employeeId }] }
          : { id: "00000000-0000-0000-0000-000000000000" },
      };
    case "own":
      return {
        scope,
        filter: { id: ctx.employeeId ?? "00000000-0000-0000-0000-000000000000" },
      };
    default:
      throw new ForbiddenError("You do not have access to employee records");
  }
}

// ─────────────────────────────────────────────── read

export async function listEmployees(ctx: RequestContext, input: ListEmployeesInput) {
  const { scope, filter } = employeeScope(ctx);

  const where: Record<string, unknown> = { ...filter };
  if (input.departmentId) where["departmentId"] = input.departmentId;
  if (input.locationId) where["locationId"] = input.locationId;
  if (input.designationId) where["designationId"] = input.designationId;
  if (input.managerId) where["managerId"] = input.managerId;
  if (input.status) where["status"] = input.status;
  if (input.employmentType) where["employmentType"] = input.employmentType;

  if (input.q) {
    where["AND"] = [
      {
        OR: [
          { firstName: { contains: input.q, mode: "insensitive" } },
          { lastName: { contains: input.q, mode: "insensitive" } },
          { employeeCode: { contains: input.q, mode: "insensitive" } },
          { workEmail: { contains: input.q, mode: "insensitive" } },
        ],
      },
    ];
  }

  const [sortField, sortDirection] = input.sort.split(":") as [string, "asc" | "desc"];
  const orderBy =
    sortField === "joinDate"
      ? [{ joinDate: sortDirection }]
      : sortField === "code"
        ? [{ employeeCode: sortDirection }]
        : [{ firstName: sortDirection }, { lastName: sortDirection }];

  const [rows, total] = await Promise.all([
    ctx.db.employee.findMany({
      where,
      orderBy,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: employeeSelect,
    }),
    ctx.db.employee.count({ where }),
  ]);

  const data = rows.map((row) =>
    toEmployeeDto(
      row as unknown as EmployeeRow,
      resolveVisibility({
        scope,
        isSelf: row.id === ctx.employeeId,
      }),
    ),
  );

  return { data, meta: { page: input.page, pageSize: input.pageSize, total } };
}

export async function getEmployee(ctx: RequestContext, id: string) {
  const { scope, filter } = employeeScope(ctx);

  const row = await ctx.db.employee.findFirst({
    where: { AND: [{ id }, filter] },
    select: employeeSelect,
  });

  // Outside the caller's scope reads the same as absent — no existence leak.
  if (!row) throw new NotFoundError("Employee");

  const visibility = resolveVisibility({ scope, isSelf: row.id === ctx.employeeId });

  const emergencyContacts =
    visibility === "self" || visibility === "hr"
      ? await ctx.db.emergencyContact.findMany({
          where: { employeeId: id, deletedAt: null },
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
          select: { id: true, name: true, relationship: true, phone: true, isPrimary: true },
        })
      : [];

  const directReports = await ctx.db.employee.findMany({
    where: { managerId: id, status: { not: "exited" } },
    orderBy: { firstName: "asc" },
    select: { id: true, firstName: true, lastName: true, employeeCode: true },
  });

  return {
    ...toEmployeeDto(row as unknown as EmployeeRow, visibility),
    emergencyContacts,
    directReports,
  };
}

/** The caller's own record, for `/me/profile`. */
export async function getOwnProfile(ctx: RequestContext) {
  if (!ctx.employeeId) {
    throw new BusinessRuleError("This account is not linked to an employee record.", {
      rule: "no_employee_record",
    });
  }
  return getEmployee(ctx, ctx.employeeId);
}

// ─────────────────────────────────────────────── write

/**
 * Next code in the `EMP0001` series.
 *
 * Guarded by a transaction-scoped advisory lock rather than by catching the
 * unique violation: a failed INSERT would poison the surrounding transaction,
 * so two simultaneous hires must be serialised before they collide, not after.
 */
async function nextEmployeeCode(ctx: RequestContext): Promise<string> {
  await ctx.db.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtext($1 || ':employee_code'))`,
    ctx.companyId,
  );

  const rows = await ctx.db.$queryRawUnsafe<{ max: number | null }[]>(
    `SELECT MAX(NULLIF(regexp_replace(employee_code, '\\D', '', 'g'), '')::bigint) AS max
       FROM employees
      WHERE company_id = $1::uuid AND employee_code ~ '^EMP[0-9]+$'`,
    ctx.companyId,
  );

  const next = Number(rows[0]?.max ?? 0) + 1;
  return `EMP${String(next).padStart(4, "0")}`;
}

export async function createEmployee(ctx: RequestContext, input: CreateEmployeeInput) {
  await assertOrgRefs(ctx, input);

  if (input.managerId) await assertManagerExists(ctx, input.managerId);

  if (input.workEmail) {
    const clash = await ctx.db.employee.findFirst({
      where: { workEmail: input.workEmail },
      select: { id: true },
    });
    if (clash) throw new ConflictError("Another employee already uses that work email");
  }

  const employeeCode = input.employeeCode ?? (await nextEmployeeCode(ctx));

  const created = await ctx.db.employee.create({
    data: {
      companyId: ctx.companyId,
      employeeCode,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      workEmail: input.workEmail ?? null,
      personalEmail: input.personalEmail ?? null,
      phone: input.phone ?? null,
      dateOfBirth: input.dateOfBirth ? fromDateOnly(input.dateOfBirth) : null,
      gender: input.gender ?? null,
      address: input.address ?? null,
      departmentId: input.departmentId,
      designationId: input.designationId,
      locationId: input.locationId,
      managerId: input.managerId ?? null,
      employmentType: input.employmentType,
      status: input.status,
      joinDate: fromDateOnly(input.joinDate),
      probationEndDate: input.probationEndDate ? fromDateOnly(input.probationEndDate) : null,
      noticePeriodDays: input.noticePeriodDays ?? null,
    },
    select: employeeSelect,
  });

  await emit(
    "employee.created",
    {
      employeeId: created.id,
      employeeCode: created.employeeCode,
      after: {
        employeeCode: created.employeeCode,
        name: [created.firstName, created.lastName].filter(Boolean).join(" "),
        departmentId: input.departmentId,
        designationId: input.designationId,
        locationId: input.locationId,
        employmentType: input.employmentType,
        status: input.status,
        joinDate: input.joinDate,
      },
    },
    actor(ctx),
  );

  let invite: { userId: string; inviteUrl?: string } | null = null;
  if (input.invite && input.workEmail) {
    invite = await inviteUser(ctx, { email: input.workEmail, employeeId: created.id });
  }

  return {
    ...toEmployeeDto(created as unknown as EmployeeRow, "hr"),
    ...(invite ? { invite } : {}),
  };
}

export async function updateEmployee(ctx: RequestContext, id: string, input: UpdateEmployeeInput) {
  const before = await ctx.db.employee.findFirst({ where: { id }, select: employeeSelect });
  if (!before) throw new NotFoundError("Employee");

  await assertOrgRefs(ctx, input);

  if (input.managerId) {
    if (input.managerId === id) {
      throw new BusinessRuleError("An employee cannot report to themselves.", {
        rule: "self_manager",
      });
    }
    await assertManagerExists(ctx, input.managerId);
    await assertNoManagerCycle(ctx, id, input.managerId);
  }

  if (input.workEmail) {
    const clash = await ctx.db.employee.findFirst({
      where: { workEmail: input.workEmail, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw new ConflictError("Another employee already uses that work email");
  }

  const data: Record<string, unknown> = { ...input };
  for (const field of [
    "dateOfBirth",
    "joinDate",
    "probationEndDate",
    "confirmationDate",
  ] as const) {
    if (input[field] !== undefined) {
      data[field] = input[field] ? fromDateOnly(input[field] as string) : null;
    }
  }

  const updated = await ctx.db.employee.update({
    where: { id },
    data,
    select: employeeSelect,
  });

  await emitUpdate(ctx, id, before, updated, Object.keys(input));
  return toEmployeeDto(updated as unknown as EmployeeRow, "hr");
}

/**
 * Self-service edit. The route already proved the caller owns the record; the
 * schema already restricted the fields. This exists so the two facts meet in
 * one place and the audit row is attributed correctly.
 */
export async function updateOwnProfile(ctx: RequestContext, input: UpdateOwnProfileInput) {
  if (!ctx.employeeId) {
    throw new BusinessRuleError("This account is not linked to an employee record.", {
      rule: "no_employee_record",
    });
  }

  const before = await ctx.db.employee.findFirst({
    where: { id: ctx.employeeId },
    select: employeeSelect,
  });
  if (!before) throw new NotFoundError("Employee");

  const updated = await ctx.db.employee.update({
    where: { id: ctx.employeeId },
    data: {
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.personalEmail !== undefined ? { personalEmail: input.personalEmail } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
    },
    select: employeeSelect,
  });

  await emitUpdate(ctx, ctx.employeeId, before, updated, Object.keys(input));
  return toEmployeeDto(updated as unknown as EmployeeRow, "self");
}

export async function changeStatus(ctx: RequestContext, id: string, input: ChangeStatusInput) {
  const employee = await ctx.db.employee.findFirst({
    where: { id },
    select: { id: true, status: true, joinDate: true, userId: true },
  });
  if (!employee) throw new NotFoundError("Employee");

  if (employee.status === input.status) return { status: input.status, changed: false };

  const allowed = STATUS_TRANSITIONS[employee.status] ?? [];
  if (!allowed.includes(input.status)) {
    throw new BusinessRuleError(
      `Cannot move an employee from ${employee.status} to ${input.status}.`,
      { rule: "invalid_status_transition", from: employee.status, to: input.status },
    );
  }

  if (input.status === "exited" && !input.exitDate) {
    throw new BusinessRuleError("An exit date is required when marking someone as exited.", {
      rule: "exit_date_required",
    });
  }

  const exitDate = input.exitDate ? fromDateOnly(input.exitDate) : null;
  if (exitDate && exitDate < employee.joinDate) {
    throw new BusinessRuleError("The exit date cannot be before the join date.", {
      rule: "exit_before_join",
    });
  }

  await ctx.db.employee.update({
    where: { id },
    data: {
      status: input.status,
      ...(input.status === "exited" ? { exitDate } : {}),
      ...(input.status === "active" && employee.status === "onboarding"
        ? { confirmationDate: null }
        : {}),
    },
  });

  // Exiting cuts off access immediately: disable the account and bump the
  // session version so any browser they left signed in stops working now,
  // not when the cookie happens to expire.
  if (input.status === "exited" && employee.userId) {
    await ctx.db.user.update({
      where: { id: employee.userId },
      data: { status: "disabled", sessionVersion: { increment: 1 } },
    });
    await emit("user.disabled", { userId: employee.userId }, actor(ctx));
  }

  await emit(
    "employee.status_changed",
    { employeeId: id, from: employee.status, to: input.status },
    actor(ctx),
  );

  return { status: input.status, changed: true };
}

export async function deleteEmployee(ctx: RequestContext, id: string) {
  const employee = await ctx.db.employee.findFirst({
    where: { id },
    select: { id: true, userId: true, user: { select: { status: true } } },
  });
  if (!employee) throw new NotFoundError("Employee");

  if (employee.id === ctx.employeeId) {
    throw new BusinessRuleError("You cannot delete your own employee record.", {
      rule: "cannot_delete_self",
    });
  }

  if (employee.user && employee.user.status !== "disabled") {
    throw new BusinessRuleError("Disable this person's login account before deleting the record.", {
      rule: "has_active_user",
    });
  }

  const reports = await ctx.db.employee.count({ where: { managerId: id } });
  if (reports > 0) {
    throw new ConflictError(
      `${reports} employee${reports === 1 ? "" : "s"} still report to this person. Reassign them first.`,
    );
  }

  await ctx.db.employee.update({ where: { id }, data: { deletedAt: new Date() } });
  await emit("employee.deleted", { employeeId: id }, actor(ctx));
}

/** Create the login account for an existing employee and email the invite. */
export async function invite(ctx: RequestContext, id: string) {
  const employee = await ctx.db.employee.findFirst({
    where: { id },
    select: { id: true, workEmail: true, status: true, userId: true },
  });
  if (!employee) throw new NotFoundError("Employee");

  if (!employee.workEmail) {
    throw new BusinessRuleError("Add a work email before sending an invite.", {
      rule: "work_email_required",
    });
  }
  if (employee.status === "exited") {
    throw new BusinessRuleError("This employee has exited.", { rule: "employee_exited" });
  }

  return inviteUser(ctx, { email: employee.workEmail, employeeId: id });
}

// ─────────────────────────────────────────────── emergency contacts

export async function listEmergencyContacts(ctx: RequestContext, employeeId: string) {
  await assertCanEditEmployee(ctx, employeeId);
  return ctx.db.emergencyContact.findMany({
    where: { employeeId, deletedAt: null },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    select: { id: true, name: true, relationship: true, phone: true, isPrimary: true },
  });
}

export async function addEmergencyContact(
  ctx: RequestContext,
  employeeId: string,
  input: EmergencyContactInput,
) {
  await assertCanEditEmployee(ctx, employeeId);

  // The database enforces one primary per employee; demote the incumbent
  // first so the caller does not have to know that.
  if (input.isPrimary) {
    await ctx.db.emergencyContact.updateMany({
      where: { employeeId, isPrimary: true, deletedAt: null },
      data: { isPrimary: false },
    });
  }

  return ctx.db.emergencyContact.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      name: input.name,
      relationship: input.relationship,
      phone: input.phone,
      isPrimary: input.isPrimary,
    },
    select: { id: true, name: true, relationship: true, phone: true, isPrimary: true },
  });
}

export async function updateEmergencyContact(
  ctx: RequestContext,
  employeeId: string,
  contactId: string,
  input: EmergencyContactInput,
) {
  await assertCanEditEmployee(ctx, employeeId);

  const existing = await ctx.db.emergencyContact.findFirst({
    where: { id: contactId, employeeId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError("Emergency contact");

  if (input.isPrimary) {
    await ctx.db.emergencyContact.updateMany({
      where: { employeeId, isPrimary: true, deletedAt: null, id: { not: contactId } },
      data: { isPrimary: false },
    });
  }

  return ctx.db.emergencyContact.update({
    where: { id: contactId },
    data: input,
    select: { id: true, name: true, relationship: true, phone: true, isPrimary: true },
  });
}

export async function deleteEmergencyContact(
  ctx: RequestContext,
  employeeId: string,
  contactId: string,
) {
  await assertCanEditEmployee(ctx, employeeId);

  const existing = await ctx.db.emergencyContact.findFirst({
    where: { id: contactId, employeeId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError("Emergency contact");

  await ctx.db.emergencyContact.update({
    where: { id: contactId },
    data: { deletedAt: new Date(), isPrimary: false },
  });
}

// ─────────────────────────────────────────────── guards

/** Either it is your own record, or you hold `employee.edit`. */
async function assertCanEditEmployee(ctx: RequestContext, employeeId: string): Promise<void> {
  if (ctx.employeeId === employeeId) return;
  if (!ctx.permissions.has("employee.edit")) {
    throw new ForbiddenError("You can only change your own record");
  }
  const exists = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError("Employee");
}

async function assertOrgRefs(
  ctx: RequestContext,
  input: { departmentId?: string; designationId?: string; locationId?: string },
): Promise<void> {
  const checks: Promise<void>[] = [];

  if (input.departmentId) {
    checks.push(
      ctx.db.department
        .findFirst({ where: { id: input.departmentId }, select: { id: true } })
        .then((row) => {
          if (!row) throw new NotFoundError("Department");
        }),
    );
  }
  if (input.designationId) {
    checks.push(
      ctx.db.designation
        .findFirst({ where: { id: input.designationId }, select: { id: true } })
        .then((row) => {
          if (!row) throw new NotFoundError("Designation");
        }),
    );
  }
  if (input.locationId) {
    checks.push(
      ctx.db.location
        .findFirst({ where: { id: input.locationId }, select: { id: true } })
        .then((row) => {
          if (!row) throw new NotFoundError("Location");
        }),
    );
  }

  await Promise.all(checks);
}

async function assertManagerExists(ctx: RequestContext, managerId: string): Promise<void> {
  const manager = await ctx.db.employee.findFirst({
    where: { id: managerId },
    select: { id: true, status: true },
  });
  if (!manager) throw new NotFoundError("Manager");
  if (manager.status === "exited") {
    throw new BusinessRuleError("That manager has exited the company.", {
      rule: "manager_exited",
    });
  }
}

/**
 * Walk up the proposed reporting line. Without this, A→B and B→A produces a
 * cycle that makes every "my team" query recurse forever.
 */
async function assertNoManagerCycle(
  ctx: RequestContext,
  employeeId: string,
  proposedManagerId: string,
): Promise<void> {
  let cursor: string | null = proposedManagerId;
  const seen = new Set<string>([employeeId]);

  for (let depth = 0; cursor && depth < 50; depth += 1) {
    if (seen.has(cursor)) {
      throw new BusinessRuleError("That would create a loop in the reporting line.", {
        rule: "manager_cycle",
      });
    }
    seen.add(cursor);

    const node: { managerId: string | null } | null = await ctx.db.employee.findFirst({
      where: { id: cursor },
      select: { managerId: true },
    });
    cursor = node?.managerId ?? null;
  }
}

async function emitUpdate(
  ctx: RequestContext,
  employeeId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  requestedFields: string[],
): Promise<void> {
  const changed = requestedFields.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
  if (changed.length === 0) return;

  await emit(
    "employee.updated",
    {
      employeeId,
      changedFields: changed,
      before: Object.fromEntries(changed.map((f) => [f, before[f] ?? null])),
      after: Object.fromEntries(changed.map((f) => [f, after[f] ?? null])),
    },
    actor(ctx),
  );
}

/** Manager picker options, scoped to the tenant. */
export async function managerOptions(ctx: RequestContext, excludeId?: string) {
  return ctx.db.employee.findMany({
    where: {
      status: { not: "exited" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { firstName: "asc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      designation: { select: { title: true } },
    },
  });
}
