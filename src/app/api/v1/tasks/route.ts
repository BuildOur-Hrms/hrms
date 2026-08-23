import { withApi } from "@/lib/api";
import { createTask, listTasks } from "@/modules/tasks/service";
import {
  createTaskSchema,
  listTasksSchema,
  type CreateTaskInput,
  type ListTasksInput,
} from "@/modules/tasks/validators";

export const runtime = "nodejs";

/**
 * GET /api/v1/tasks — one person's month.
 *
 * No permission declared: the service resolves how far the caller can see and
 * refuses beyond it. Declaring `view_own` here would turn a manager's request
 * for a report's list into a 403 instead of a scoped answer.
 */
export const GET = withApi<Record<string, never>, ListTasksInput>(
  { query: listTasksSchema },
  async ({ ctx, query }) => listTasks(ctx, query),
);

/**
 * POST /api/v1/tasks
 *
 * Whether this is an assignment or something the person added for themselves
 * is decided by who they are creating it for — never by the body.
 */
export const POST = withApi<CreateTaskInput>(
  {
    permission: "performance.create",
    body: createTaskSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createTask(ctx, body),
);
