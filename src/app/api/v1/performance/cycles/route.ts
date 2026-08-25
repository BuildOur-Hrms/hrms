import { withApi } from "@/lib/api";
import { createCycle, listCycles } from "@/modules/performance/service";
import {
  createCycleSchema,
  listCyclesSchema,
  type CreateCycleInput,
  type ListCyclesInput,
} from "@/modules/performance/validators";

export const runtime = "nodejs";

/**
 * The review periods a company runs.
 *
 * `performance.view_own` is the floor: an employee needs to know which cycle
 * is open before they can set a goal against it.
 */
export const GET = withApi<Record<string, never>, ListCyclesInput>(
  { permission: "performance.view_own", query: listCyclesSchema },
  async ({ ctx, query }) => listCycles(ctx, query),
);

export const POST = withApi<CreateCycleInput>(
  {
    permission: "performance.manage",
    body: createCycleSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createCycle(ctx, body),
);
