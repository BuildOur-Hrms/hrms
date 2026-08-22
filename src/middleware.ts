import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, readSessionToken } from "@/lib/session";

/**
 * Route guard for the authenticated shell (docs/05-architecture.md §4).
 *
 * This is a redirect convenience, NOT an authorization boundary. It only
 * proves the cookie decrypts; it does not check `session_version`, account
 * status or permissions, because doing so needs the database and middleware
 * runs on the Edge. Every real check happens in `withApi` on the request that
 * actually touches data — a forged navigation past this point lands on a page
 * whose API calls all return 401.
 */

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const claims = await readSessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!claims) {
    if (isPublic) return NextResponse.next();

    const login = new URL("/login", req.url);
    // Come back here after signing in, but only for in-app destinations —
    // an attacker-supplied absolute URL would turn this into an open redirect.
    if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }

  // Already signed in: the auth screens have nothing to offer.
  if (isPublic) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except API routes (which authenticate themselves and must
   * answer 401 rather than redirect), Next internals and static files.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
