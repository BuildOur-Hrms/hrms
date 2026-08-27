import type { RequestContext } from "@/lib/context";
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";
import { inviteUser } from "@/modules/auth/service";

import type { CreateRoleInput, SetPermissionsInput, UpdateRoleInput } from "./validators";

/**
 * Roles, grants and user accounts (docs/08-api.md §3).
 *
 * Two guards here exist to stop an administrator locking the company out of
 * its own system: you cannot disable yourself, and you cannot remove the last
 * account that holds `hr_admin`. Both are business rules, not permissions —
 * the caller is allowed to do the action in general, just not this instance
 * of it.
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

// ─────────────────────────────────────────────── roles

export async function listRoles(ctx: RequestContext) {
  const roles = await ctx.db.role.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      rolePermissions: { select: { permission: { select: { code: true } } } },
      _count: { select: { userRoles: true } },
    },
  });

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    userCount: role._count.userRoles,
    permissions: role.rolePermissions.map((rp) => rp.permission.code).sort(),
  }));
}

/** The platform catalog, grouped for the roles screen. */
export function listPermissions() {
  const byModule = new Map<string, PermissionCode[]>();
  for (const permission of PERMISSIONS) {
    const bucket = byModule.get(permission.module) ?? [];
    bucket.push(permission.code);
    byModule.set(permission.module, bucket);
  }
  return [...byModule.entries()]
    .map(([module, codes]) => ({ module, permissions: codes.sort() }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

/**
 * A permission the caller does not hold is a permission they cannot grant.
 *
 * This is the whole security of custom roles. `roles.manage` belongs to
 * hr_admin, so without this an HR administrator could mint a role holding
 * `platform.manage`, give it to themselves, and be a super administrator by
 * lunchtime. The rule is the ordinary one: you may hand out what you have.
 *
 * Super administrators hold everything, so it never binds on them. It binds
 * hard on any narrower role that is later given `roles.manage`, which is
 * exactly when it matters.
 */
function assertMayGrant(ctx: RequestContext, codes: readonly string[]): void {
  const beyond = codes.filter((code) => !ctx.permissions.has(code as PermissionCode));
  if (beyond.length === 0) return;

  throw new ForbiddenError(
    `You cannot grant a permission you do not hold yourself: ${beyond.sort().join(", ")}.`,
  );
}

/** System roles are the seeded four. They are the floor, and nothing edits them. */
async function loadEditableRole(ctx: RequestContext, id: string) {
  const role = await ctx.db.role.findFirst({
    where: { id },
    select: { id: true, name: true, isSystem: true },
  });
  if (!role) throw new NotFoundError("Role");

  if (role.isSystem) {
    throw new BusinessRuleError(
      `${role.name} is a system role and cannot be changed. Make a role of your own instead.`,
      { rule: "system_role" },
    );
  }
  return role;
}

export async function createRole(ctx: RequestContext, input: CreateRoleInput) {
  assertMayGrant(ctx, input.permissions);

  const clash = await ctx.db.role.findFirst({
    where: { name: input.name },
    select: { id: true },
  });
  if (clash) throw new ConflictError(`A role called ${input.name} already exists.`);

  const permissionIds = await permissionIdsFor(ctx, input.permissions);

  const role = await ctx.db.role.create({
    data: {
      companyId: ctx.companyId,
      name: input.name,
      description: input.description ?? null,
      isSystem: false,
      rolePermissions: {
        create: permissionIds.map((permissionId) => ({ permissionId })),
      },
    },
    select: { id: true, name: true },
  });

  await emit(
    "role.changed",
    {
      roleId: role.id,
      name: role.name,
      action: "created",
      permissions: [...input.permissions].sort(),
    },
    actor(ctx),
  );
  return role;
}

export async function updateRole(ctx: RequestContext, id: string, input: UpdateRoleInput) {
  const role = await loadEditableRole(ctx, id);

  const updated = await ctx.db.role.update({
    where: { id },
    data: { description: input.description ?? null },
    select: { id: true, name: true, description: true },
  });

  await emit("role.changed", { roleId: id, name: role.name, action: "updated" }, actor(ctx));
  return updated;
}

/**
 * Replace a role's permissions wholesale.
 *
 * A whole set rather than add/remove one at a time, because the screen shows
 * the whole set and a half-applied change to who can see payroll is worse
 * than a rejected one.
 *
 * Note what is *not* guarded: taking a permission away from a role you hold
 * through that role. It is allowed, it takes effect on your next request, and
 * it is recoverable by a super administrator. Guarding it would mean deciding
 * which of somebody's roles counts, and getting that wrong locks people out
 * of their own company more often than the mistake it prevents.
 */
export async function setRolePermissions(
  ctx: RequestContext,
  id: string,
  input: SetPermissionsInput,
) {
  const role = await loadEditableRole(ctx, id);
  assertMayGrant(ctx, input.permissions);

  const permissionIds = await permissionIdsFor(ctx, input.permissions);

  await ctx.db.rolePermission.deleteMany({ where: { roleId: id } });
  if (permissionIds.length > 0) {
    await ctx.db.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
    });
  }

  await emit(
    "role.changed",
    {
      roleId: id,
      name: role.name,
      action: "permissions_set",
      permissions: [...input.permissions].sort(),
    },
    actor(ctx),
  );
  return { id, permissions: [...input.permissions].sort() };
}

export async function deleteRole(ctx: RequestContext, id: string) {
  const role = await loadEditableRole(ctx, id);

  // Held by somebody is the one case worth refusing rather than cascading:
  // deleting a role out from under its holders changes what those people can
  // do, silently, and the person deleting it cannot see who they are.
  const holders = await ctx.db.userRole.count({ where: { roleId: id } });
  if (holders > 0) {
    throw new BusinessRuleError(
      `${role.name} is still held by ${holders} ${holders === 1 ? "person" : "people"}. Take it off them first.`,
      { rule: "role_in_use" },
    );
  }

  await ctx.db.rolePermission.deleteMany({ where: { roleId: id } });
  await ctx.db.role.delete({ where: { id } });

  await emit("role.changed", { roleId: id, name: role.name, action: "deleted" }, actor(ctx));
  return { id };
}

/**
 * Codes to ids, refusing anything the catalogue does not define.
 *
 * The zod schema already rejects unknown codes, so this failing means the
 * `permissions` table and the code's catalogue have drifted — which is worth
 * an error that says so rather than a role that silently holds less than it
 * was given.
 */
async function permissionIdsFor(ctx: RequestContext, codes: readonly string[]): Promise<string[]> {
  if (codes.length === 0) return [];

  const rows = await ctx.db.permission.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true, code: true },
  });

  if (rows.length !== new Set(codes).size) {
    const found = new Set(rows.map((row) => row.code));
    const missing = [...new Set(codes)].filter((code) => !found.has(code));
    throw new BusinessRuleError(
      `The permissions table does not have: ${missing.join(", ")}. Re-run the seed.`,
      { rule: "permission_catalogue_drift" },
    );
  }

  return rows.map((row) => row.id);
}

// ─────────────────────────────────────────────── users

export interface ListUsersInput {
  page: number;
  pageSize: number;
  q?: string;
  status?: "invited" | "active" | "disabled";
  role?: string;
}

export async function listUsers(ctx: RequestContext, input: ListUsersInput) {
  const where: Record<string, unknown> = {};
  if (input.status) where["status"] = input.status;
  if (input.q) where["email"] = { contains: input.q, mode: "insensitive" };
  if (input.role) where["userRoles"] = { some: { role: { name: input.role } } };

  const [rows, total] = await Promise.all([
    ctx.db.user.findMany({
      where,
      orderBy: { email: "asc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        email: true,
        status: true,
        lastLoginAt: true,
        lockedUntil: true,
        createdAt: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        userRoles: { select: { role: { select: { id: true, name: true } } } },
      },
    }),
    ctx.db.user.count({ where }),
  ]);

  const data = rows.map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status,
    lastLoginAt: row.lastLoginAt,
    /** Surfaced so HR can explain "I can't log in" without reading the audit log. */
    isLocked: !!row.lockedUntil && row.lockedUntil > new Date(),
    createdAt: row.createdAt,
    employee: row.employee,
    roles: row.userRoles.map((ur) => ur.role),
  }));

  return { data, meta: { page: input.page, pageSize: input.pageSize, total } };
}

export async function assignRole(ctx: RequestContext, userId: string, roleId: string) {
  const [user, role] = await Promise.all([
    ctx.db.user.findFirst({ where: { id: userId }, select: { id: true } }),
    ctx.db.role.findFirst({ where: { id: roleId }, select: { id: true, name: true } }),
  ]);
  if (!user) throw new NotFoundError("User");
  if (!role) throw new NotFoundError("Role");

  await ctx.db.userRole.upsert({
    where: { userId_roleId: { userId, roleId } },
    create: { userId, roleId, assignedBy: ctx.userId },
    update: {},
  });

  await emitRoles(ctx, userId);
  return { userId, roleId };
}

export async function removeRole(ctx: RequestContext, userId: string, roleId: string) {
  const role = await ctx.db.role.findFirst({
    where: { id: roleId },
    select: { id: true, name: true },
  });
  if (!role) throw new NotFoundError("Role");

  if (role.name === "hr_admin") await assertNotLastHrAdmin(ctx, userId);

  await ctx.db.userRole.deleteMany({ where: { userId, roleId } });
  await emitRoles(ctx, userId);
}

export async function setUserEnabled(ctx: RequestContext, userId: string, enabled: boolean) {
  const user = await ctx.db.user.findFirst({
    where: { id: userId },
    select: { id: true, status: true },
  });
  if (!user) throw new NotFoundError("User");

  if (!enabled) {
    if (userId === ctx.userId) {
      throw new BusinessRuleError("You cannot disable your own account.", {
        rule: "cannot_disable_self",
      });
    }
    await assertNotLastHrAdmin(ctx, userId);
  }

  await ctx.db.user.update({
    where: { id: userId },
    data: enabled
      ? { status: "active", failedLoginCount: 0, lockedUntil: null }
      : // Bumping the session version is what actually ends their access;
        // without it a disabled user keeps working until their cookie expires.
        { status: "disabled", sessionVersion: { increment: 1 } },
  });

  await emit(enabled ? "user.enabled" : "user.disabled", { userId }, actor(ctx));
  return { userId, status: enabled ? "active" : "disabled" };
}

/** Clear a lockout early, for the "I'm locked out" support call. */
export async function unlockUser(ctx: RequestContext, userId: string) {
  const user = await ctx.db.user.findFirst({ where: { id: userId }, select: { id: true } });
  if (!user) throw new NotFoundError("User");

  await ctx.db.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  return { userId, unlocked: true };
}

export async function resendInvite(ctx: RequestContext, userId: string) {
  const user = await ctx.db.user.findFirst({
    where: { id: userId },
    select: { id: true, email: true, status: true, employee: { select: { id: true } } },
  });
  if (!user) throw new NotFoundError("User");

  if (user.status === "active") {
    throw new BusinessRuleError("This account is already active.", { rule: "not_invited_state" });
  }

  return inviteUser(ctx, { email: user.email, employeeId: user.employee?.id ?? null });
}

// ─────────────────────────────────────────────── guards

/**
 * Refuse the change if it would leave the company with no enabled `hr_admin`.
 * Locking everyone out is recoverable only by someone with database access,
 * which a pilot customer does not have.
 */
async function assertNotLastHrAdmin(ctx: RequestContext, userId: string): Promise<void> {
  const remaining = await ctx.db.user.count({
    where: {
      id: { not: userId },
      status: { not: "disabled" },
      userRoles: { some: { role: { name: "hr_admin" } } },
    },
  });

  if (remaining === 0) {
    throw new BusinessRuleError(
      "This is the last HR administrator. Give someone else the role first.",
      { rule: "last_hr_admin" },
    );
  }
}

async function emitRoles(ctx: RequestContext, userId: string): Promise<void> {
  const rows = await ctx.db.userRole.findMany({
    where: { userId },
    select: { role: { select: { name: true } } },
  });
  await emit(
    "user.roles_changed",
    { userId, roles: rows.map((r) => r.role.name).sort() },
    actor(ctx),
  );
}

/**
 * Invite somebody directly, with the roles they should have.
 *
 * The employee-first path — create a record, tick "send invite" — is right for
 * a new hire. It is wrong for the person who administers the system: an HR
 * admin brought in to run the thing may have no employee record yet, and
 * until this existed there was no way to create their account at all through
 * the product.
 *
 * Roles are applied here rather than left for a second step, because an
 * account with no roles can sign in and see nothing, which looks like the
 * product being broken.
 *
 * An employee record may be attached as it goes out. Optional, because the
 * administrator this path exists for genuinely has none — but offered,
 * because a member of staff invited this way by mistake lands on an account
 * with nothing behind it, and an account that has been signed in to cannot
 * be invited again. Attaching here is cheaper than linking afterwards.
 */
export async function inviteWithRoles(
  ctx: RequestContext,
  input: { email: string; roleIds: string[]; employeeId?: string | null },
) {
  const roles = await ctx.db.role.findMany({
    where: { id: { in: input.roleIds } },
    select: { id: true, name: true },
  });
  if (roles.length !== input.roleIds.length) throw new NotFoundError("Role");

  if (input.employeeId) {
    const employee = await ctx.db.employee.findFirst({
      where: { id: input.employeeId },
      select: { id: true, userId: true },
    });
    if (!employee) throw new NotFoundError("Employee");
    if (employee.userId) {
      throw new BusinessRuleError("That employee already has an account.", {
        rule: "employee_has_account",
      });
    }
  }

  const result = await inviteUser(ctx, {
    email: input.email,
    employeeId: input.employeeId ?? null,
  });

  for (const role of roles) {
    await ctx.db.userRole.upsert({
      where: { userId_roleId: { userId: result.userId, roleId: role.id } },
      create: { userId: result.userId, roleId: role.id, assignedBy: ctx.userId },
      update: {},
    });
  }

  await emitRoles(ctx, result.userId);
  return result;
}

/**
 * Remove an account that was never used.
 *
 * Deliberately narrow. A mistyped email creates an account nobody can ever
 * sign in to, and leaving that lying around is untidy — but an account that
 * has signed in has done things, and those things point at it. Deleting it
 * would strip the actor from its own audit trail, so anything with a login,
 * an employee record or a role beyond the baseline is disabled instead.
 */
export async function deleteUnusedAccount(ctx: RequestContext, userId: string) {
  const user = await ctx.db.user.findFirst({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      lastLoginAt: true,
      employee: { select: { id: true } },
    },
  });
  if (!user) throw new NotFoundError("User");

  if (userId === ctx.userId) {
    throw new BusinessRuleError("You cannot delete your own account.", { rule: "self_delete" });
  }
  if (user.lastLoginAt || user.status === "active") {
    throw new BusinessRuleError(
      "This account has been used. Disable it instead, so its audit trail keeps its author.",
      { rule: "account_used" },
    );
  }
  if (user.employee) {
    throw new BusinessRuleError(
      "This account belongs to an employee record. Remove the link or disable the account instead.",
      { rule: "account_linked" },
    );
  }

  await ctx.db.userRole.deleteMany({ where: { userId } });
  await ctx.db.passwordResetToken.deleteMany({ where: { userId } });
  await ctx.db.user.delete({ where: { id: userId } });

  await emit("user.deleted", { userId }, actor(ctx));
}
