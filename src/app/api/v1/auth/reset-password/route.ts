import { requestMeta, withApi } from "@/lib/api";
import { resetPassword } from "@/modules/auth/service";
import { resetPasswordSchema, type ResetPasswordInput } from "@/modules/auth/validators";

export const runtime = "nodejs";

/** POST /api/v1/auth/reset-password — public, consumes a `reset` token. */
export const POST = withApi<ResetPasswordInput>(
  { public: true, body: resetPasswordSchema, rateLimit: "resetPassword" },
  async ({ body, req }) => {
    await resetPassword(body, "reset", requestMeta(req));
    return { ok: true };
  },
);
