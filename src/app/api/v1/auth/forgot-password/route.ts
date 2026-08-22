import { requestMeta, withApi } from "@/lib/api";
import { forgotPassword } from "@/modules/auth/service";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/modules/auth/validators";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/forgot-password — public.
 * Always 200, whether or not the address exists (docs/08-api.md §2).
 */
export const POST = withApi<ForgotPasswordInput>(
  { public: true, body: forgotPasswordSchema, rateLimit: "forgotPassword" },
  async ({ body, req }) => {
    await forgotPassword(body, requestMeta(req));
    return { ok: true };
  },
);
