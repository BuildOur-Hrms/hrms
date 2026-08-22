import { NextResponse } from "next/server";

import { requestMeta, withApi } from "@/lib/api";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";
import { login } from "@/modules/auth/service";
import { loginSchema, type LoginInput } from "@/modules/auth/validators";

export const runtime = "nodejs";

/** POST /api/v1/auth/login — public. docs/08-api.md §2. */
export const POST = withApi<LoginInput>(
  { public: true, body: loginSchema, rateLimit: "login" },
  async ({ body, req }) => {
    const result = await login(body, requestMeta(req));

    const response = NextResponse.json({
      data: {
        user: result.user,
        roles: result.roles,
        permissions: result.permissions,
      },
    });
    response.cookies.set(SESSION_COOKIE_NAME, result.token, sessionCookieOptions());
    return response;
  },
);
