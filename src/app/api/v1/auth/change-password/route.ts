import { NextResponse } from "next/server";

import { withApi } from "@/lib/api";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";
import { changePassword } from "@/modules/auth/service";
import { changePasswordSchema, type ChangePasswordInput } from "@/modules/auth/validators";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/change-password — signed in, own account only.
 *
 * No permission beyond the session: the only account this can change is the
 * one making the request. Rate limited as a mutation because the current
 * password is checked here, which makes it somewhere to guess one.
 *
 * The response carries a fresh session cookie. Changing a password ends every
 * other session, and without re-issuing this one it would end the caller's
 * too — logging somebody out of the screen they just used to secure their
 * account, which teaches them not to bother next time.
 */
export const POST = withApi<ChangePasswordInput>(
  { body: changePasswordSchema, rateLimit: "mutation" },
  async ({ ctx, body }) => {
    const { token } = await changePassword(ctx, body);

    const response = NextResponse.json({ data: { ok: true } });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return response;
  },
);
