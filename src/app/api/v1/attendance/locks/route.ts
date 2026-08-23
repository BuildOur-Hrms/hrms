import { withApi } from "@/lib/api";
import { listLocks, lockMonth, unlockMonth } from "@/modules/attendance/locks";
import {
  lockActionSchema,
  lockListSchema,
  type LockActionInput,
  type LockListInput,
} from "@/modules/attendance/validators";

export const runtime = "nodejs";

export const GET = withApi<Record<string, never>, LockListInput>(
  { permission: "attendance.view_all", query: lockListSchema },
  async ({ ctx, query }) => listLocks(ctx, query.year),
);

/**
 * Lock or reopen a month.
 *
 * One endpoint with an explicit `action` rather than a toggle: reopening a
 * month payroll has already run against is a decision someone should have to
 * name, not something they arrive at by clicking the same button twice.
 */
export const POST = withApi<LockActionInput>(
  { permission: "attendance.manage", body: lockActionSchema, rateLimit: "mutation" },
  async ({ ctx, body }) =>
    body.action === "lock"
      ? lockMonth(ctx, body.year, body.month, body.note)
      : unlockMonth(ctx, body.year, body.month),
);
