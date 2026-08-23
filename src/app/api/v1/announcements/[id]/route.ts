import { z } from "zod";

import { withApi } from "@/lib/api";
import { assertCanAnnounce, deleteAnnouncement } from "@/modules/notifications/service";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
type Params = { id: string };

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: paramsSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    assertCanAnnounce(ctx);
    await deleteAnnouncement(ctx, params.id);
    return { ok: true };
  },
);
