import { withApi } from "@/lib/api";
import { completeOwnProfile } from "@/modules/employees/service";
import { completeProfileSchema, type CompleteProfileInput } from "@/modules/employees/validators";

export const runtime = "nodejs";

/**
 * POST /api/v1/me/profile/complete
 *
 * Finishing setup after an invite: saves whatever was filled in and stamps
 * the record so the prompt stops coming back.
 *
 * One request rather than a save followed by a stamp, so a browser that dies
 * between them cannot leave somebody marked as finished with none of their
 * answers saved. An empty body is "skip for now", and is allowed on purpose —
 * a prompt that cannot be dismissed is an obstacle.
 */
export const POST = withApi<CompleteProfileInput>(
  { body: completeProfileSchema, rateLimit: "mutation" },
  async ({ ctx, body }) => completeOwnProfile(ctx, body),
);
