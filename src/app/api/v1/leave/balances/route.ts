import { withApi } from "@/lib/api";
import { listBalances } from "@/modules/leave/balances";
import { balanceQuerySchema, type BalanceQueryInput } from "@/modules/leave/validators";

export const runtime = "nodejs";

/** Own balances by default; another employee's needs team or company scope. */
export const GET = withApi<Record<string, never>, BalanceQueryInput>(
  { query: balanceQuerySchema },
  async ({ ctx, query }) => listBalances(ctx, query.year, query.employeeId),
);
