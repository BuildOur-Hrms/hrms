import { withApi } from "@/lib/api";
import { adjustBalance } from "@/modules/leave/balances";
import { adjustBalanceSchema, type AdjustBalanceInput } from "@/modules/leave/validators";

export const runtime = "nodejs";

/** A manual credit or debit. The reason is required and lands in the audit. */
export const POST = withApi<AdjustBalanceInput>(
  { permission: "leave.manage", body: adjustBalanceSchema, rateLimit: "mutation" },
  async ({ ctx, body }) => adjustBalance(ctx, body),
);
