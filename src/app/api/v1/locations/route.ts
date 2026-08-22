import { withApi } from "@/lib/api";
import { createLocation, listLocations } from "@/modules/org/service";
import { createLocationSchema, type CreateLocationInput } from "@/modules/org/validators";

export const runtime = "nodejs";

/** Readable by any authenticated user: locations appear in every employee form. */
export const GET = withApi({}, async ({ ctx }) => listLocations(ctx));

export const POST = withApi<CreateLocationInput>(
  {
    permission: "company.manage",
    body: createLocationSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createLocation(ctx, body),
);
