import type { RequestContext } from "@/lib/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";

import type { DataContext } from "./service";

/**
 * Month locks: the payroll-safe freeze.
 *
 * Once a month is locked the attendance inside it stops moving — no punches,
 * no corrections, no recomputation. Payroll is calculated from these numbers,
 * and a number that can still change after payslips are issued is not a number
 * anyone can defend.
 *
 * The lock is enforced in two places on purpose. This module answers "is that
 * month frozen", and every write path asks before it writes; separately, each
 * record carries a `locked` flag so a single day can answer for itself without
 * a join. The flag is set when the month is locked and cleared when it is
 * reopened, so the two never disagree.
 */

function actor(ctx: RequestContext): EventActor {
  return {
    userId: ctx.userId,
    companyId: ctx.companyId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    db: ctx.db,
  };
}

/** The month a `YYYY-MM-DD` belongs to. */
export function monthOf(workDate: string): { year: number; month: number } {
  const [year, month] = workDate.split("-").map(Number);
  return { year: year!, month: month! };
}

/**
 * Throws if the month containing `workDate` is frozen.
 *
 * Called by every path that would move attendance. Deliberately a query rather
 * than a cached flag: a lock applied a second ago has to be honoured by the
 * request already in flight.
 */
export async function assertMonthOpen(ctx: DataContext, workDate: string): Promise<void> {
  const { year, month } = monthOf(workDate);
  const lock = await ctx.db.attendanceMonthLock.findFirst({
    where: { year, month },
    select: { lockedAt: true },
  });
  if (lock) {
    throw new ConflictError(
      `${year}-${String(month).padStart(2, "0")} is locked for payroll. Ask HR to reopen it.`,
    );
  }
}

export async function listLocks(ctx: RequestContext, year: number) {
  const locks = await ctx.db.attendanceMonthLock.findMany({
    where: { year },
    orderBy: { month: "asc" },
    select: {
      id: true,
      year: true,
      month: true,
      lockedAt: true,
      note: true,
      user: { select: { id: true, email: true } },
    },
  });
  return locks;
}

/** First instant of a month, and the first instant of the next one. */
function monthRange(year: number, month: number) {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
  };
}

export async function lockMonth(
  ctx: RequestContext,
  year: number,
  month: number,
  note?: string | null,
) {
  const existing = await ctx.db.attendanceMonthLock.findFirst({
    where: { year, month },
    select: { id: true },
  });
  if (existing) throw new ConflictError("That month is already locked.");

  const { from, to } = monthRange(year, month);

  const lock = await ctx.db.attendanceMonthLock.create({
    data: { companyId: ctx.companyId, year, month, lockedBy: ctx.userId, note: note ?? null },
    select: { id: true, year: true, month: true, lockedAt: true, note: true },
  });

  // Stamp the days so a record can answer for itself. Anything created after
  // this point is refused by `assertMonthOpen` before it can be written.
  const stamped = await ctx.db.attendanceRecord.updateMany({
    where: { workDate: { gte: from, lt: to } },
    data: { locked: true },
  });

  await emit(
    "attendance.month_locked",
    { year, month, action: "locked", records: stamped.count },
    actor(ctx),
  );

  return { ...lock, records: stamped.count };
}

/**
 * Reopen a month.
 *
 * Deliberately separate from locking rather than a toggle: unlocking a month
 * that payroll has already run against is a decision someone should have to
 * make on purpose, and an audit entry should show they did.
 */
export async function unlockMonth(ctx: RequestContext, year: number, month: number) {
  const lock = await ctx.db.attendanceMonthLock.findFirst({
    where: { year, month },
    select: { id: true },
  });
  if (!lock) throw new NotFoundError("Month lock");

  const { from, to } = monthRange(year, month);

  await ctx.db.attendanceMonthLock.delete({ where: { id: lock.id } });
  const cleared = await ctx.db.attendanceRecord.updateMany({
    where: { workDate: { gte: from, lt: to } },
    data: { locked: false },
  });

  await emit(
    "attendance.month_locked",
    { year, month, action: "reopened", records: cleared.count },
    actor(ctx),
  );

  return { year, month, records: cleared.count };
}
