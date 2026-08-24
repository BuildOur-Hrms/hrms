import { list, withApi } from "@/lib/api";
import { createCandidate, listCandidates } from "@/modules/recruitment/service";
import {
  createCandidateSchema,
  listCandidatesSchema,
  type CreateCandidateInput,
  type ListCandidatesInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

/** The talent pool. */
export const GET = withApi<Record<string, never>, ListCandidatesInput>(
  { query: listCandidatesSchema },
  async ({ ctx, query }) => {
    const result = await listCandidates(ctx, query);
    return list(result.data, result.meta);
  },
);

export const POST = withApi<CreateCandidateInput>(
  {
    permission: "recruitment.edit",
    body: createCandidateSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createCandidate(ctx, body),
);
