import { withApi } from "@/lib/api";
import { listExits, resign } from "@/modules/checklists/offboarding";
import {
  listExitsSchema,
  resignSchema,
  type ListExitsInput,
  type ResignInput,
} from "@/modules/checklists/validators";

export const runtime = "nodejs";

/**
 * Exits, scoped to the caller.
 *
 * `view_own` is the floor: an employee looking at their own resignation is
 * the commonest read here. Which rows come back is settled in the service.
 */
export const GET = withApi<Record<string, never>, ListExitsInput>(
  { permission: "offboarding.view_own", query: listExitsSchema },
  async ({ ctx, query }) => listExits(ctx, query),
);

/**
 * File a resignation.
 *
 * `offboarding.create` is held by every employee, because resigning is
 * something everybody may do. Filing on somebody else's behalf needs more,
 * and the service checks for it.
 */
export const POST = withApi<ResignInput>(
  {
    permission: "offboarding.create",
    body: resignSchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => resign(ctx, body),
);
