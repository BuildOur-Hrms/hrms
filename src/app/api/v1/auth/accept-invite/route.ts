import { requestMeta, withApi } from "@/lib/api";
import { resetPassword } from "@/modules/auth/service";
import { acceptInviteSchema, type AcceptInviteInput } from "@/modules/auth/validators";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/accept-invite — public, consumes an `invite` token and
 * activates the account. Same mechanics as a reset; the token kind is what
 * keeps an invite link from being replayed as a password reset.
 */
export const POST = withApi<AcceptInviteInput>(
  { public: true, body: acceptInviteSchema, rateLimit: "resetPassword" },
  async ({ body, req }) => {
    await resetPassword(body, "invite", requestMeta(req));
    return { ok: true };
  },
);
