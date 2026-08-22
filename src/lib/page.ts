import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { authenticate } from "./context";
import { withTenant } from "./db";
import { ForbiddenError } from "./errors";
import type { PermissionCode } from "./permissions";
import { SESSION_COOKIE_NAME, readSessionToken } from "./session";

/**
 * Server-component counterpart to `withApi`.
 *
 * A page needs the same authentication and tenant resolution an API route
 * does, but it cannot hold the transaction open past render, so this returns
 * plain data rather than a database handle. Pages that need to *read* data run
 * their query inside `withPageData` below; pages that need to *write* go
 * through `/api/v1` like any other client.
 */

export interface PageSession {
  userId: string;
  companyId: string;
  employeeId: string | null;
  roles: readonly string[];
  permissions: ReadonlySet<PermissionCode>;
  isSuperAdmin: boolean;
  email: string;
  firstName: string | null;
  lastName: string | null;
  photoKey: string | null;
  company: { id: string; name: string; slug: string; timezone: string; currency: string };
}

/** Redirects to the login screen when there is no usable session. */
export async function requireSession(): Promise<PageSession> {
  const store = await cookies();
  const claims = await readSessionToken(store.get(SESSION_COOKIE_NAME)?.value);
  if (!claims) redirect("/login");

  try {
    return await withTenant(claims.companyId, async (db) => {
      const identity = await authenticate(db, claims);

      const user = await db.user.findFirst({
        where: { id: identity.userId },
        select: {
          email: true,
          company: { select: { id: true, name: true, slug: true, timezone: true, currency: true } },
          employee: { select: { firstName: true, lastName: true, photoKey: true } },
        },
      });
      if (!user) redirect("/login");

      return {
        ...identity,
        email: user.email,
        firstName: user.employee?.firstName ?? null,
        lastName: user.employee?.lastName ?? null,
        photoKey: user.employee?.photoKey ?? null,
        company: user.company,
      } satisfies PageSession;
    });
  } catch (error) {
    // `redirect()` works by throwing; let that through untouched.
    if (isRedirectError(error)) throw error;
    redirect("/login");
  }
}

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

/**
 * Run a read inside the session's tenant transaction, for pages that fetch
 * their own initial data instead of round-tripping through the API.
 */
export async function withPageData<T>(
  session: PageSession,
  fn: (db: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>,
): Promise<T> {
  return withTenant(session.companyId, fn, { superAdmin: session.isSuperAdmin });
}

/** Server-side permission gate for a whole page. */
export function requirePagePermission(session: PageSession, code: PermissionCode): void {
  if (!session.permissions.has(code)) {
    throw new ForbiddenError(`Missing permission: ${code}`);
  }
}

export function pageCan(session: PageSession, code: PermissionCode): boolean {
  return session.permissions.has(code);
}
