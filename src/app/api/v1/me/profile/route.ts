import { withApi } from "@/lib/api";
import { getOwnProfile, updateOwnProfile } from "@/modules/employees/service";
import { updateOwnProfileSchema, type UpdateOwnProfileInput } from "@/modules/employees/validators";

export const runtime = "nodejs";

export const GET = withApi({}, async ({ ctx }) => getOwnProfile(ctx));

/**
 * PATCH /api/v1/me/profile
 *
 * The schema is the allowlist: only contact details. An employee changing
 * their own department or join date is not a thing that can be expressed
 * through this endpoint.
 */
export const PATCH = withApi<UpdateOwnProfileInput>(
  { body: updateOwnProfileSchema, rateLimit: "mutation" },
  async ({ ctx, body }) => updateOwnProfile(ctx, body),
);
