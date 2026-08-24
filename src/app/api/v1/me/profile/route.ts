import { withApi } from "@/lib/api";
import { getOwnProfile, setUpOwnProfile, updateOwnProfile } from "@/modules/employees/service";
import {
  setUpOwnProfileSchema,
  updateOwnProfileSchema,
  type SetUpOwnProfileInput,
  type UpdateOwnProfileInput,
} from "@/modules/employees/validators";

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

/**
 * POST /api/v1/me/profile
 *
 * For an account that has no employee record yet — the platform owner, most
 * often, since the seed gives one to the HR admin and not to them.
 *
 * `employee.create` is the same permission that already lets these accounts
 * create a record for anybody in the company, so this grants nothing new. It
 * only wires one to themselves.
 */
export const POST = withApi<SetUpOwnProfileInput>(
  {
    permission: "employee.create",
    body: setUpOwnProfileSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => setUpOwnProfile(ctx, body),
);
