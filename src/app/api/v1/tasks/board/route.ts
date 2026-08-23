import { withApi } from "@/lib/api";
import { taskBoard } from "@/modules/tasks/service";
import { boardSchema, type BoardInput } from "@/modules/tasks/validators";

export const runtime = "nodejs";

/**
 * GET /api/v1/tasks/board — everyone the caller may see, for one month.
 *
 * The scope decides the permission, so it is checked in the service: a manager
 * and an HR admin hit the same URL and get different people.
 */
export const GET = withApi<Record<string, never>, BoardInput>(
  { query: boardSchema },
  async ({ ctx, query }) => taskBoard(ctx, query),
);
