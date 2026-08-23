import { z } from "zod";

import { withApi } from "@/lib/api";
import { assertCanAnnounce, publishAnnouncement } from "@/modules/notifications/service";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
type Params = { id: string };

/** Publishing is what fans the announcement out as notifications. */
export const POST = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: paramsSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    assertCanAnnounce(ctx);
    return publishAnnouncement(ctx, params.id);
  },
);
