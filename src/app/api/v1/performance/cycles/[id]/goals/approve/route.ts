import { z } from "zod";

import { withApi } from "@/lib/api";
import { approveGoals } from "@/modules/performance/service";
import { idParamSchema } from "@/modules/performance/validators";

export const runtime = "nodejs";

type Params = { id: string };

const bodySchema = z.object({ employeeId: z.string().uuid() });
type Body = z.infer<typeof bodySchema>;

/** A manager agreeing somebody's whole goal set. */
export const POST = withApi<Body, Record<string, never>, Params>(
  {
    permission: "performance.approve",
    params: idParamSchema,
    body: bodySchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => approveGoals(ctx, params.id, body.employeeId),
);
