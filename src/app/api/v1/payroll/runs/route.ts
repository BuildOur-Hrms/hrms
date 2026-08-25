import { withApi } from "@/lib/api";
import { createRun, listRuns } from "@/modules/payroll/service";
import {
  createRunSchema,
  listRunsSchema,
  type CreateRunInput,
  type ListRunsInput,
} from "@/modules/payroll/validators";

export const runtime = "nodejs";

export const GET = withApi<Record<string, never>, ListRunsInput>(
  { permission: "payroll.view_all", query: listRunsSchema },
  async ({ ctx, query }) => listRuns(ctx, query),
);

/** Open a month. Refused unless attendance for it is locked. */
export const POST = withApi<CreateRunInput>(
  { permission: "payroll.manage", body: createRunSchema, rateLimit: "mutation", status: 201 },
  async ({ ctx, body }) => createRun(ctx, body),
);
