import { withApi } from "@/lib/api";
import { setOfferStatus } from "@/modules/recruitment/service";
import {
  idParamSchema,
  offerStatusSchema,
  type OfferStatusInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Send an offer, or record what came back.
 *
 * Sending is the gated step and needs `recruitment.approve`, which the
 * service checks — declaring it here would also block recording a decline,
 * which anybody editing the pipeline should be able to do.
 */
export const POST = withApi<OfferStatusInput, Record<string, never>, Params>(
  { body: offerStatusSchema, params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, body, params }) => setOfferStatus(ctx, params.id, body),
);
