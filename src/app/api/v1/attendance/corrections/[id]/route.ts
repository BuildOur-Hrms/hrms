import { withApi } from "@/lib/api";
import { cancelCorrection } from "@/modules/attendance/corrections";
import { idParamSchema } from "@/modules/attendance/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * Withdraw your own pending request. Cancelling is deliberately a DELETE that
 * sets a status rather than removing the row: the fact that someone asked and
 * then thought better of it is part of the record.
 */
export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { permission: "attendance.create", params: idParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => cancelCorrection(ctx, params.id),
);
