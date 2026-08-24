import { withApi } from "@/lib/api";
import { listTasks } from "@/modules/checklists/service";
import { listTasksSchema, type ListTasksInput } from "@/modules/checklists/validators";

export const runtime = "nodejs";

/**
 * Checklist tasks, scoped to the caller.
 *
 * `onboarding.view_own` is the floor because everybody has it: a new joiner
 * asking what they still have to do is the commonest read this endpoint
 * serves. Which rows come back is settled in the service, from scope.
 */
export const GET = withApi<Record<string, never>, ListTasksInput>(
  { permission: "onboarding.view_own", query: listTasksSchema },
  async ({ ctx, query }) => listTasks(ctx, query),
);
