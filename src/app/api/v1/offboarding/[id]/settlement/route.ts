import { withApi } from "@/lib/api";
import { recordSettlement } from "@/modules/checklists/offboarding";
import {
  idParamSchema,
  settlementSchema,
  type SettlementInput,
} from "@/modules/checklists/validators";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * What is owed, written down for payroll to pick up.
 *
 * Recorded, not calculated: payroll does not exist yet, and a figure invented
 * here is a number somebody might act on.
 */
export const POST = withApi<SettlementInput, Record<string, never>, Params>(
  {
    permission: "offboarding.manage",
    params: idParamSchema,
    body: settlementSchema,
    rateLimit: "mutation",
  },
  async ({ ctx, params, body }) => recordSettlement(ctx, params.id, body),
);
