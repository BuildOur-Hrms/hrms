import { z } from "zod";

import { withApi } from "@/lib/api";
import { previewMonth } from "@/modules/payroll/service";

export const runtime = "nodejs";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
type Query = z.infer<typeof querySchema>;

/**
 * What a month would pay, without saving anything.
 *
 * The same code path approval uses, so what HR reviews is what gets approved
 * rather than a preview that happens to agree most of the time.
 */
export const GET = withApi<Record<string, never>, Query>(
  { permission: "payroll.view_all", query: querySchema },
  async ({ ctx, query }) => ({ rows: await previewMonth(ctx, query.year, query.month) }),
);
