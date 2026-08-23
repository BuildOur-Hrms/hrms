import { z } from "zod";

import { withApi } from "@/lib/api";
import { markAnnouncementRead } from "@/modules/notifications/service";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
type Params = { id: string };

export const POST = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: paramsSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => markAnnouncementRead(ctx, params.id),
);
