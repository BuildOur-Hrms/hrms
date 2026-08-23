import { z } from "zod";

import { list, withApi } from "@/lib/api";
import { runReport } from "@/modules/reports/service";
import {
  reportParamsSchema,
  reportQuerySchema,
  type ReportQueryInput,
} from "@/modules/reports/validators";

export const runtime = "nodejs";

type Params = z.infer<typeof reportParamsSchema>;

/**
 * `GET /reports/:slug` (docs/08-api.md §Reports).
 *
 * The scope decides the permission, so it is checked in the service — a
 * manager and an HR admin hit the same URL and get different rows.
 */
export const GET = withApi<Record<string, never>, ReportQueryInput, Params>(
  { query: reportQuerySchema, params: reportParamsSchema },
  async ({ ctx, query, params }) => {
    const run = await runReport(ctx, params.slug, query);
    return list(run.data, run.meta);
  },
);
