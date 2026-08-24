import { withApi } from "@/lib/api";
import { createOffer, listOffers } from "@/modules/recruitment/service";
import {
  createOfferSchema,
  listOffersSchema,
  type CreateOfferInput,
  type ListOffersInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

export const GET = withApi<Record<string, never>, ListOffersInput>(
  { query: listOffersSchema },
  async ({ ctx, query }) => listOffers(ctx, query),
);

export const POST = withApi<CreateOfferInput>(
  {
    permission: "recruitment.edit",
    body: createOfferSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createOffer(ctx, body),
);
