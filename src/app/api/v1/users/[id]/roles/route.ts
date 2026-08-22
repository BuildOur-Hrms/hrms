import { z } from "zod";

import { withApi } from "@/lib/api";
import { assignRole } from "@/modules/rbac/service";

export const runtime = "nodejs";

const bodySchema = z.object({ roleId: z.string().uuid() });
const paramsSchema = z.object({ id: z.string().uuid() });

type Body = z.infer<typeof bodySchema>;
type Params = z.infer<typeof paramsSchema>;

export const POST = withApi<Body, Record<string, never>, Params>(
  { permission: "roles.manage", body: bodySchema, params: paramsSchema, rateLimit: "mutation" },
  async ({ ctx, body, params }) => assignRole(ctx, params.id, body.roleId),
);
