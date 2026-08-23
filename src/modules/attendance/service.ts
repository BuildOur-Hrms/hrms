import type { RequestContext } from "@/lib/context";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope } from "@/lib/permissions";
import { effectiveShift } from "@/modules/shifts/service";

import { calcAttendance, resolveWorkDate, type ShiftRules } from "./calc";
import type { PunchInput } from "./validators";

/**
 * Punches and the daily records derived from them.
 *
 * The rules themselves live in `calc.ts` and are pure. This layer does the
 * things a pure function cannot: decide which employee and which timezone,
 * read the shift in force, write the punch, and rebuild the day's record.
 *
 * A record is always derived, never authoritative — `recomputeDay` can be run
 * again at any time and must produce the same answer from the same punches.
 * That is what makes the correction flow (and a bug fix in the calculator)
 * safe to apply retroactively.
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

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The zone an employee's wall clock runs on: their location's, falling back to
 * the company's. A shift that starts at 09:00 means 09:00 where the person
 * actually is, not where the server happens to run.
 */
async function employeeContext(ctx: RequestContext, employeeId: string) {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      location: { select: { timezone: true } },
      company: { select: { timezone: true } },
    },
  });
  if (!employee) throw new NotFoundError("Employee");

  return {
    employee,
    timeZone: employee.location?.timezone ?? employee.company.timezone,
  };
}

/** The caller's own employee record, or a clear error explaining why not. */
function ownEmployeeId(ctx: RequestContext): string {
  if (!ctx.employeeId) {
    throw new ConflictError(
      "This account has no employee record, so there is nothing to record attendance against.",
    );
  }
  return ctx.employeeId;
}

/**
 * Own record always; direct reports with `attendance.view_team`; everyone with
 * `attendance.view_all`. Out of scope reads as absent rather than forbidden,
 * so this cannot be used to probe which employee ids exist.
 */
async function assertCanViewAttendance(ctx: RequestContext, employeeId: string): Promise<void> {
  if (ctx.employeeId === employeeId) return;

  const scope = resolveScope(ctx, "attendance");
  if (scope === "none" || scope === "own") {
    throw new ForbiddenError("You can only see your own attendance");
  }

  const where =
    scope === "all"
      ? { id: employeeId }
      : { id: employeeId, managerId: ctx.employeeId ?? "00000000-0000-0000-0000-000000000000" };

  const visible = await ctx.db.employee.findFirst({ where, select: { id: true } });
  if (!visible) throw new NotFoundError("Employee");
}

async function shiftRulesFor(
  ctx: RequestContext,
  employeeId: string,
  on: Date,
): Promise<ShiftRules & { id: string; name: string }> {
  const shift = await effectiveShift(ctx, employeeId, on);
  if (!shift) {
    throw new ConflictError(
      "No shift applies to this employee and no default shift is set, so attendance cannot be measured. Add a shift first.",
    );
  }
  return shift as ShiftRules & { id: string; name: string };
}

// ─────────────────────────────────────────────── punching

/**
 * Record a check-in or check-out for the signed-in employee.
 *
 * The direction is checked against the last punch of the same work date. The
 * calculator tolerates a duplicated check-in — biometric devices produce them
 * — but a web button knows exactly what state it is in, so a second check-in
 * here is a mistake worth naming rather than absorbing.
 */
export async function punch(ctx: RequestContext, input: PunchInput) {
  const employeeId = ownEmployeeId(ctx);
  const { timeZone } = await employeeContext(ctx, employeeId);

  const now = new Date();

  // The shift is needed to know which work date the punch belongs to, and the
  // work date is needed to look up the shift. Resolve with the punch instant's
  // own date, then settle if the boundary moved it.
  const provisional = await shiftRulesFor(ctx, employeeId, now);
  const workDate = resolveWorkDate(now, timeZone, provisional);
  const shift =
    workDate === isoDate(now)
      ? provisional
      : await shiftRulesFor(ctx, employeeId, toDateOnly(workDate));

  const last = await lastPunchOfDay(ctx, employeeId, workDate, timeZone, shift);
  if (last && last.direction === input.direction) {
    throw new ConflictError(
      input.direction === "in"
        ? "You are already checked in."
        : "You are already checked out. Check in first.",
    );
  }
  if (!last && input.direction === "out") {
    throw new ConflictError("There is no check-in to close. Check in first.");
  }

  const created = await ctx.db.attendancePunch.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      punchedAt: now,
      direction: input.direction,
      source: "web",
      note: input.note ?? null,
    },
    select: { id: true, punchedAt: true, direction: true },
  });

  const record = await recomputeDay(ctx, employeeId, workDate);

  await emit(
    "attendance.punched",
    { employeeId, punchId: created.id, direction: input.direction, workDate },
    actor(ctx),
  );

  return { punch: created, workDate, record };
}

/**
 * Punches belonging to one work date. Not simply "punches on this calendar
 * date" — an overnight shift's punches straddle two of them.
 */
async function punchesForDay(
  ctx: RequestContext,
  employeeId: string,
  workDate: string,
  timeZone: string,
  shift: Pick<ShiftRules, "startTime" | "endTime">,
) {
  // Widen by a day either side, then keep what resolves to this work date.
  const from = new Date(toDateOnly(workDate).getTime() - 86_400_000);
  const to = new Date(toDateOnly(workDate).getTime() + 2 * 86_400_000);

  const rows = await ctx.db.attendancePunch.findMany({
    where: { employeeId, punchedAt: { gte: from, lt: to } },
    orderBy: { punchedAt: "asc" },
    select: { id: true, punchedAt: true, direction: true, source: true, note: true },
  });

  return rows.filter((p) => resolveWorkDate(p.punchedAt, timeZone, shift) === workDate);
}

async function lastPunchOfDay(
  ctx: RequestContext,
  employeeId: string,
  workDate: string,
  timeZone: string,
  shift: Pick<ShiftRules, "startTime" | "endTime">,
) {
  const punches = await punchesForDay(ctx, employeeId, workDate, timeZone, shift);
  return punches.at(-1) ?? null;
}

// ─────────────────────────────────────────────── records

/**
 * Rebuild one employee-day from its punches and write it.
 *
 * Idempotent by construction: it reads punches, runs the pure calculator and
 * upserts the result, so running it twice changes nothing and running it after
 * a correction picks the correction up.
 */
export async function recomputeDay(ctx: RequestContext, employeeId: string, workDate: string) {
  const { timeZone } = await employeeContext(ctx, employeeId);
  const shift = await shiftRulesFor(ctx, employeeId, toDateOnly(workDate));
  const punches = await punchesForDay(ctx, employeeId, workDate, timeZone, shift);

  const result = calcAttendance({
    workDate,
    timeZone,
    shift,
    punches: punches.map((p) => ({ punchedAt: p.punchedAt, direction: p.direction })),
    // Leave and holidays arrive with M3; until then every working day is one.
    isHoliday: false,
    isOnLeave: false,
  });

  const data = {
    status: result.status,
    firstIn: result.firstIn,
    lastOut: result.lastOut,
    workedMinutes: result.workedMinutes,
    lateMinutes: result.lateMinutes,
    overtimeMinutes: result.overtimeMinutes,
    needsReview: result.needsReview,
  };

  return ctx.db.attendanceRecord.upsert({
    where: {
      companyId_employeeId_workDate: {
        companyId: ctx.companyId,
        employeeId,
        workDate: toDateOnly(workDate),
      },
    },
    create: {
      companyId: ctx.companyId,
      employeeId,
      workDate: toDateOnly(workDate),
      source: "web",
      ...data,
    },
    // Deliberately does not touch overtime approval: recomputation must not
    // silently revoke a decision a manager already made.
    update: data,
    select: {
      status: true,
      firstIn: true,
      lastOut: true,
      workedMinutes: true,
      lateMinutes: true,
      overtimeMinutes: true,
      overtimeApproved: true,
      needsReview: true,
      locked: true,
    },
  });
}

/**
 * One day for one employee: the shift it was measured against, the punches,
 * and the computed record.
 */
export async function getDay(ctx: RequestContext, employeeId: string, date?: string) {
  await assertCanViewAttendance(ctx, employeeId);

  const { timeZone } = await employeeContext(ctx, employeeId);
  const now = new Date();
  const provisional = await shiftRulesFor(ctx, employeeId, now);
  const workDate = date ?? resolveWorkDate(now, timeZone, provisional);

  const shift = await shiftRulesFor(ctx, employeeId, toDateOnly(workDate));
  const punches = await punchesForDay(ctx, employeeId, workDate, timeZone, shift);

  const record = await ctx.db.attendanceRecord.findFirst({
    where: { employeeId, workDate: toDateOnly(workDate) },
    select: {
      status: true,
      firstIn: true,
      lastOut: true,
      workedMinutes: true,
      lateMinutes: true,
      overtimeMinutes: true,
      overtimeApproved: true,
      needsReview: true,
      locked: true,
    },
  });

  // An odd number of punches means one is still open, which is what the
  // check-in button needs to know to show the right label.
  const openPunch = punches.length > 0 && punches.at(-1)!.direction === "in";

  return {
    workDate,
    timeZone,
    shift: {
      id: shift.id,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      graceMinutes: shift.graceMinutes,
    },
    punches,
    record,
    checkedIn: openPunch,
  };
}
