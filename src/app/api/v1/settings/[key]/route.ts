import { z } from "zod";

import { withApi } from "@/lib/api";
import { setSetting } from "@/modules/settings/service";

export const runtime = "nodejs";

const bodySchema = z.object({ value: z.unknown() });
const paramsSchema = z.object({ key: z.string().min(1).max(120) });

type Body = z.infer<typeof bodySchema>;
type Params = z.infer<typeof paramsSchema>;

/**
 * PUT /api/v1/settings/:key
 *
 * The value is validated against the catalog entry for the key, not by this
 * schema — one endpoint serves every setting shape.
 */
export const PUT = withApi<Body, Record<string, never>, Params>(
  {
    permission: "settings.manage",
    body: bodySchema,
    params: paramsSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, body, params }) => setSetting(ctx, params.key, body.value),
);
