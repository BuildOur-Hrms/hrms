import { NextResponse } from "next/server";

import { withApi } from "@/lib/api";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";
import { logout } from "@/modules/auth/service";

export const runtime = "nodejs";

/** POST /api/v1/auth/logout — clears the session cookie. */
export const POST = withApi({}, async ({ ctx }) => {
  await logout(ctx);

  const response = NextResponse.json({ data: { ok: true } });
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions(0), maxAge: 0 });
  return response;
});
