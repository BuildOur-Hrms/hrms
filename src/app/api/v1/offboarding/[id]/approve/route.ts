import { withApi } from "@/lib/api";
import { approveResignation } from "@/modules/checklists/offboarding";
import { idParamSchema } from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** The manager's approval. Whether this exit is theirs is decided in the service. */
export const POST = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "offboarding.approve", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => approveResignation(ctx, params.id),
);
