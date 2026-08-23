import { z } from "zod";

import { withApi } from "@/lib/api";
import { taskTrend } from "@/modules/tasks/service";
import { boardSchema } from "@/modules/tasks/validators";

export const runtime = "nodejs";

const querySchema = boardSchema.extend({ employeeId: z.string().uuid().optional() });
type Query = z.infer<typeof querySchema>;

/** GET /api/v1/tasks/trend — one person's completion, month by month. */
export const GET = withApi<Record<string, never>, Query>(
  { query: querySchema },
  async ({ ctx, query }) => {
    const employeeId = query.employeeId ?? ctx.employeeId;
    if (!employeeId) return [];
    return taskTrend(ctx, employeeId, query);
  },
);
