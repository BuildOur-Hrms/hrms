import type { RequestContext } from "@/lib/context";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";
import { inviteUser } from "@/modules/auth/service";

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
 */
export async function inviteWithRoles(
  ctx: RequestContext,
  input: { email: string; roleIds: string[] },
) {
  const roles = await ctx.db.role.findMany({
    where: { id: { in: input.roleIds } },
    select: { id: true, name: true },
  });
  if (roles.length !== input.roleIds.length) throw new NotFoundError("Role");

  const result = await inviteUser(ctx, { email: input.email, employeeId: null });

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
