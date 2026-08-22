import { withApi } from "@/lib/api";
import { createDesignation, listDesignations } from "@/modules/org/service";
import { createDesignationSchema, type CreateDesignationInput } from "@/modules/org/validators";

export const runtime = "nodejs";

export const GET = withApi({}, async ({ ctx }) => listDesignations(ctx));

export const POST = withApi<CreateDesignationInput>(
  {
    permission: "designation.manage",
    body: createDesignationSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createDesignation(ctx, body),
);
