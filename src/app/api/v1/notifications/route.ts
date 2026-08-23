import { z } from "zod";

import { withApi } from "@/lib/api";
import { listNotifications } from "@/modules/notifications/service";

export const runtime = "nodejs";

const querySchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type Query = z.infer<typeof querySchema>;

/** Always the caller's own; there is no notion of reading somebody else's. */
export const GET = withApi<Record<string, never>, Query>(
  { query: querySchema },
  async ({ ctx, query }) => listNotifications(ctx, query),
);
