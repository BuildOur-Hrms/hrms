import { withApi } from "@/lib/api";
import { getApplication } from "@/modules/recruitment/service";
import { idParamSchema } from "@/modules/recruitment/validators";

export const runtime = "nodejs";

type Params = { id: string };

/** One application with its interviews and offers. */
export const GET = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: idParamSchema },
  async ({ ctx, params }) => getApplication(ctx, params.id),
);
