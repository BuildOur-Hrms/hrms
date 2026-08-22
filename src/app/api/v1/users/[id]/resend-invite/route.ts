import { z } from "zod";

import { withApi } from "@/lib/api";
import { resendInvite } from "@/modules/rbac/service";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
type Params = z.infer<typeof paramsSchema>;

export const POST = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "users.manage", params: paramsSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => resendInvite(ctx, params.id),
);
