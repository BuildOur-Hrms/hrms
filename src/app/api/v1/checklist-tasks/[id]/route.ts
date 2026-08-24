import { withApi } from "@/lib/api";
import { setTaskStatus } from "@/modules/checklists/service";
import {
  completeTaskSchema,
  idParamSchema,
  type CompleteTaskInput,
} from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Settle a task — done, or deliberately not.
 *
 * `view_own` again: the person a task was given to is usually the one who
 * finishes it, and they hold nothing more than that. Whether this particular
 * task is theirs is decided in the service, which answers 404 when it is not.
 */
export const PATCH = withApi<CompleteTaskInput, Record<string, never>, Params>(
  {
    permission: "onboarding.view_own",
    params: idParamSchema,
    body: completeTaskSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => setTaskStatus(ctx, params.id, body),
);
