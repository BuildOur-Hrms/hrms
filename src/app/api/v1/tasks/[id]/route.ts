import { withApi } from "@/lib/api";
import { deleteTask, updateTask } from "@/modules/tasks/service";
import { idParamSchema, updateTaskSchema, type UpdateTaskInput } from "@/modules/tasks/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Who may change what is decided in the service: the person doing the work
 * owns their progress, and the shape of the target belongs to whoever set it.
 */
export const PATCH = withApi<UpdateTaskInput, Record<string, never>, Params>(
  { body: updateTaskSchema, params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, body, params }) => updateTask(ctx, params.id, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteTask(ctx, params.id);
    return { ok: true };
  },
);
