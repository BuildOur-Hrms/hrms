import { z } from "zod";

import { withApi } from "@/lib/api";
import { markRead } from "@/modules/notifications/service";

export const runtime = "nodejs";

/** Omit the id to mark everything read. */
const bodySchema = z.object({ id: z.string().uuid().optional() });
type Body = z.infer<typeof bodySchema>;

export const POST = withApi<Body>(
  { body: bodySchema, rateLimit: "mutation" },
  async ({ ctx, body }) => markRead(ctx, body.id),
);
