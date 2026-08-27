import { AuthError } from "./errors";
import type { PermissionCode } from "./permissions";
import type { RequestLogger } from "./logger";
import type { TenantTx } from "./db";
import type { SessionClaims } from "./session";

/**
 * Everything a service is allowed to know about its caller.
 *
 * `db` is bound to the request's transaction, which already has the RLS
 * session variables set. Services must use `ctx.db` and never import a client
 * of their own — that is the single choke point that makes tenant isolation
 * true by construction instead of by discipline.
 */
/**
 * Stands in for "this account has no employee record".
 *
 * It has to be a well-formed uuid. These values go into filters against
 * `employee_id`, and Postgres does not compare an empty string to a uuid
 * column — it raises, which turns "you own nothing" into a 500 for exactly
 * the accounts that own nothing: administrators with no employee record.
 * The zero uuid matches no row, which is the answer that was wanted.
 */
export const NOBODY = "00000000-0000-0000-0000-000000000000";

export interface RequestContext {
  userId: string;
  companyId: string;
  /** null for a user account with no employee record yet (rare: platform admin). */
  employeeId: string | null;
  roles: readonly string[];
  permissions: ReadonlySet<PermissionCode>;
  isSuperAdmin: boolean;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  db: TenantTx;
  log: RequestLogger;
}

/** The shape `withApi` builds before the transaction opens. */
export interface AuthenticatedIdentity {
  userId: string;
  companyId: string;
  employeeId: string | null;
  roles: string[];
  permissions: Set<PermissionCode>;
  isSuperAdmin: boolean;
}

interface UserRoleRow {
  role: {
    name: string;
    rolePermissions: { permission: { code: string } }[];
  };
}

/**
 * Load identity, roles and permissions for the token holder, and reject the
 * request if anything about the account has changed since the token was issued.
 *
 * Permissions are read fresh here on every request, on purpose: a revoked role
 * must stop working immediately, not when the cookie expires.
 */
export async function authenticate(
  db: TenantTx,
  claims: SessionClaims,
): Promise<AuthenticatedIdentity> {
  const user = await db.user.findFirst({
    where: { id: claims.userId },
    select: {
      id: true,
      companyId: true,
      status: true,
      sessionVersion: true,
      employee: { select: { id: true, deletedAt: true } },
      userRoles: {
        select: {
          role: {
            select: {
              name: true,
              rolePermissions: { select: { permission: { select: { code: true } } } },
            },
          },
        },
      },
    },
  });

  // A missing row here means the token points at a user this tenant cannot
  // see — treat it exactly like an expired session.
  if (!user) throw new AuthError("Session is no longer valid");
  if (user.status !== "active") throw new AuthError("Account is not active");
  if (user.sessionVersion !== claims.sessionVersion) {
    throw new AuthError("Session has been revoked");
  }

  const roleRows = user.userRoles as UserRoleRow[];
  const roles = roleRows.map((r) => r.role.name);
  const permissions = new Set<PermissionCode>(
    roleRows.flatMap((r) =>
      r.role.rolePermissions.map((rp) => rp.permission.code as PermissionCode),
    ),
  );

  return {
    userId: user.id,
    companyId: user.companyId,
    employeeId: user.employee && !user.employee.deletedAt ? user.employee.id : null,
    roles,
    permissions,
    isSuperAdmin: roles.includes("super_admin"),
  };
}
