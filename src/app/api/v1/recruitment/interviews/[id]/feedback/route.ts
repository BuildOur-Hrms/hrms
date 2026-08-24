import { withApi } from "@/lib/api";
import { submitFeedback } from "@/modules/recruitment/service";
import {
  idParamSchema,
  interviewFeedbackSchema,
  type InterviewFeedbackInput,
} from "@/modules/recruitment/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * The interviewer's verdict.
 *
 * No permission declared: the person who sat the round may write it, and so
 * may somebody running hiring. Declaring one here would lock out the
 * interviewer, who is the whole point.
 */
export const POST = withApi<InterviewFeedbackInput, Record<string, never>, Params>(
  { body: interviewFeedbackSchema, params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, body, params }) => submitFeedback(ctx, params.id, body),
);
