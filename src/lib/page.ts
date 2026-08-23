import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { authenticate } from "./context";
import { withTenant } from "./db";
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

/**
 * Redirects to the login screen when there is no usable session.
 *
 * Wrapped in React's `cache` because the authenticated shell calls this and so
 * does every page inside it — Next renders both in the same pass, so without
 * memoisation each page load resolved the session twice, as two separate
 * transactions. That is ten database round trips where five will do, and it is
 * paid on every single navigation.
 *
 * `cache` is scoped to one render pass, so this never leaks a session between
 * requests: a second request gets its own empty cache and re-reads the cookie.
 */
export const requireSession = cache(async function requireSession(): Promise<PageSession> {
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
});

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
  // Deliberately does NOT set the RLS bypass flag for super admins. A platform
  // owner browsing their own company needs no escape — normal tenant scoping
  // resolves everything they can see — and turning the backstop off on every
  // page they load would mean the layer only protects the people least likely
  // to need protecting from. Cross-company reads go through `withPlatform`,
  // explicitly, in platform services.
  return withTenant(session.companyId, fn);
}

/**
 * Server-side permission check for a page.
 *
 * There is deliberately no `requirePagePermission` that throws. In production
 * React strips the message from a server-component error and gives the
 * boundary only a digest, so a thrown ForbiddenError is indistinguishable from
 * a crash — the user sees "something went wrong" for an entirely ordinary
 * situation. Pages branch on this and render `<NoAccess />` instead.
 */
export function pageCan(session: PageSession, code: PermissionCode): boolean {
  return session.permissions.has(code);
}
