import { z } from "zod";

import { withApi } from "@/lib/api";
import { managerOptions } from "@/modules/employees/service";

export const runtime = "nodejs";

const querySchema = z.object({ exclude: z.string().uuid().optional() });
type Query = z.infer<typeof querySchema>;

/** Candidate managers for the employee form. */
export const GET = withApi<Record<string, never>, Query>(
  { permission: "employee.view_all", query: querySchema },
  async ({ ctx, query }) => managerOptions(ctx, query.exclude),
);
