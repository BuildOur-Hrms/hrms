import { withApi } from "@/lib/api";
import { listCorrections, requestCorrection } from "@/modules/attendance/corrections";
import {
  correctionListSchema,
  correctionRequestSchema,
  type CorrectionListInput,
  type CorrectionRequestInput,
} from "@/modules/attendance/validators";

export const runtime = "nodejs";

/** `scope=mine` for your own requests, `scope=team` for the approval queue. */
export const GET = withApi<Record<string, never>, CorrectionListInput>(
  { query: correctionListSchema },
  async ({ ctx, query }) => listCorrections(ctx, query),
);

export const POST = withApi<CorrectionRequestInput>(
  {
    permission: "attendance.create",
    body: correctionRequestSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => requestCorrection(ctx, body),
);
