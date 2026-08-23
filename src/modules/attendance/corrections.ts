import type { RequestContext } from "@/lib/context";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";

import { assertMonthOpen } from "./locks";
import { recomputeDay } from "./service";
import type {
  CorrectionListInput,
  CorrectionRequestInput,
  CorrectionReviewInput,
  ManualEntryInput,
} from "./validators";

/**
 * Regularization: "I forgot to punch out on Tuesday".
 *
 * Approving a correction never edits the punch stream. It appends `manual`
 * punches for the times asked for, attributed to the reviewer, and recomputes
 * the day. The record stays derived, the original stream stays intact, and the
 * audit shows both what was originally pressed and what a human decided
 * afterwards — which is the entire reason punches are append-only.
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

const CORRECTION_FIELDS = {
  id: true,
  workDate: true,
  requestedIn: true,
  requestedOut: true,
  requestedStatus: true,
  reason: true,
  status: true,
  reviewedAt: true,
  reviewNote: true,
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  reviewer: { select: { id: true, email: true } },
} as const;

function ownEmployeeId(ctx: RequestContext): string {
  if (!ctx.employeeId) {
    throw new ConflictError(
      "This account has no employee record, so there is no attendance to correct.",
    );
  }
  return ctx.employeeId;
}

// ─────────────────────────────────────────────── requesting

export async function requestCorrection(ctx: RequestContext, input: CorrectionRequestInput) {
  const employeeId = ownEmployeeId(ctx);

  await assertMonthOpen(ctx, input.workDate);

  const record = await ctx.db.attendanceRecord.findFirst({
    where: { employeeId, workDate: toDateOnly(input.workDate) },
    select: { locked: true },
  });
  // Belt and braces alongside `assertMonthOpen`: the per-day flag catches a
  // record frozen on its own, without a month lock behind it.
  if (record?.locked) {
    throw new ConflictError("That month is locked. Ask HR to reopen it.");
  }

  const existing = await ctx.db.attendanceCorrection.findFirst({
    where: { employeeId, workDate: toDateOnly(input.workDate), status: "pending" },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(
      "There is already a pending request for that day. Cancel it before raising another.",
    );
  }

  const correction = await ctx.db.attendanceCorrection.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      workDate: toDateOnly(input.workDate),
      requestedIn: input.requestedIn ? new Date(input.requestedIn) : null,
      requestedOut: input.requestedOut ? new Date(input.requestedOut) : null,
      requestedStatus: input.requestedStatus ?? null,
      reason: input.reason,
    },
    select: CORRECTION_FIELDS,
  });

  await emit(
    "attendance.correction_requested",
    { employeeId, correctionId: correction.id, workDate: input.workDate },
    actor(ctx),
  );

  return present(correction);
}

export async function cancelCorrection(ctx: RequestContext, id: string) {
  const employeeId = ownEmployeeId(ctx);

  const correction = await ctx.db.attendanceCorrection.findFirst({
    where: { id, employeeId },
    select: { id: true, status: true },
  });
  // Someone else's request reads as absent rather than forbidden, so this
  // cannot be used to discover which ids exist.
  if (!correction) throw new NotFoundError("Correction");
  if (correction.status !== "pending") {
    throw new ConflictError(`This request is already ${correction.status}.`);
  }

  const updated = await ctx.db.attendanceCorrection.update({
    where: { id },
    data: { status: "cancelled" },
    select: CORRECTION_FIELDS,
  });

  await emit("attendance.correction_cancelled", { employeeId, correctionId: id }, actor(ctx));
  return present(updated);
}

// ─────────────────────────────────────────────── reviewing

/**
 * Approve or reject someone else's request.
 *
 * Approving is the moment a day's value changes, so the guards are explicit:
 * the caller must hold `attendance.approve`, the request must still be
 * pending, and it must not be their own. A manager approving their own missed
 * punch is the exact self-dealing this workflow exists to prevent — and
 * holding `attendance.manage` does not buy an exemption, because an HR admin
 * is just as capable of forgetting to punch out.
 */
export async function reviewCorrection(
  ctx: RequestContext,
  id: string,
  input: CorrectionReviewInput,
) {
  if (!ctx.permissions.has("attendance.approve")) {
    throw new ForbiddenError("You cannot review attendance corrections");
  }

  const correction = await ctx.db.attendanceCorrection.findFirst({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      workDate: true,
      status: true,
      requestedIn: true,
      requestedOut: true,
      employee: { select: { managerId: true } },
    },
  });
  if (!correction) throw new NotFoundError("Correction");

  if (correction.employeeId === ctx.employeeId) {
    throw new ForbiddenError("You cannot review your own correction request");
  }
  if (correction.status !== "pending") {
    throw new ConflictError(`This request is already ${correction.status}.`);
  }

  // A manager may act on their own reports; company-wide reach needs the
  // company-wide permission rather than a team one.
  const companyWide =
    ctx.permissions.has("attendance.view_all") || ctx.permissions.has("attendance.manage");
  if (!companyWide && correction.employee.managerId !== ctx.employeeId) {
    throw new ForbiddenError("You can only review corrections for your own team");
  }

  const workDate = isoDate(correction.workDate);

  // A month can be locked between the request and the review, and approving
  // would write punches into a period payroll has already settled.
  await assertMonthOpen(ctx, workDate);

  if (input.decision === "approved") {
    // Append rather than edit. `manual` and `createdBy` together mean the day
    // can always be read back as "these two punches were entered by a person".
    const punches = [
      { at: correction.requestedIn, direction: "in" as const },
      { at: correction.requestedOut, direction: "out" as const },
    ].filter((p): p is { at: Date; direction: "in" | "out" } => p.at != null);

    if (punches.length > 0) {
      await ctx.db.attendancePunch.createMany({
        data: punches.map((p) => ({
          companyId: ctx.companyId,
          employeeId: correction.employeeId,
          punchedAt: p.at,
          direction: p.direction,
          source: "manual" as const,
          note: `Correction ${correction.id}`,
          createdBy: ctx.userId,
        })),
      });
    }
  }

  const updated = await ctx.db.attendanceCorrection.update({
    where: { id },
    data: {
      status: input.decision,
      reviewedBy: ctx.userId,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote ?? null,
    },
    select: CORRECTION_FIELDS,
  });

  // Recompute after the update, so an approved status override is already
  // visible to the query that re-applies it.
  if (input.decision === "approved") {
    await recomputeDay(ctx, correction.employeeId, workDate);
  }

  await emit(
    "attendance.correction_reviewed",
    {
      employeeId: correction.employeeId,
      correctionId: id,
      workDate,
      decision: input.decision,
    },
    actor(ctx),
  );

  return present(updated);
}

// ─────────────────────────────────────────────── reading

export async function listCorrections(ctx: RequestContext, input: CorrectionListInput) {
  const where: Record<string, unknown> = {};
  if (input.status) where["status"] = input.status;

  if (input.scope === "mine") {
    where["employeeId"] = ownEmployeeId(ctx);
  } else {
    if (!ctx.permissions.has("attendance.approve")) {
      throw new ForbiddenError("You cannot review attendance corrections");
    }
    const companyWide =
      ctx.permissions.has("attendance.view_all") || ctx.permissions.has("attendance.manage");
    if (!companyWide) {
      // A manager's queue is their own reports, and never themselves — they
      // cannot action their own request, so listing it here would only offer
      // a button that always fails.
      where["employee"] = { managerId: ctx.employeeId ?? "00000000-0000-0000-0000-000000000000" };
    }
  }

  const rows = await ctx.db.attendanceCorrection.findMany({
    where,
    orderBy: [{ status: "asc" }, { workDate: "desc" }],
    take: 200,
    select: CORRECTION_FIELDS,
  });

  return rows.map(present);
}

type CorrectionRow = { workDate: Date } & Record<string, unknown>;

/** Dates leave as `YYYY-MM-DD`; a serialised Date would carry a meaningless time. */
function present<T extends CorrectionRow>(row: T) {
  return { ...row, workDate: isoDate(row.workDate) };
}

// ─────────────────────────────────────────────── manual entry

/**
 * HR entering a day on somebody's behalf (docs/01-modules-core.md §Attendance).
 *
 * Written as an already-approved correction rather than as its own kind of
 * record, and that is the whole design. A status the punches cannot produce —
 * `on_leave` on a day nobody clocked in — survives only because `recomputeDay`
 * reads it back from an approved correction on every rebuild. Anything stored
 * elsewhere would be quietly reverted by the nightly job the same evening.
 *
 * So a manual entry is a correction that skipped the asking: same table, same
 * override path, same audit shape, and one place in the codebase that knows
 * how a day gets overridden.
 */
export async function enterDayManually(ctx: RequestContext, input: ManualEntryInput) {
  if (!ctx.permissions.has("attendance.edit")) {
    throw new ForbiddenError("You cannot enter attendance for other people");
  }

  const employee = await ctx.db.employee.findFirst({
    where: { id: input.employeeId },
    select: { id: true, joinDate: true, exitDate: true },
  });
  // A foreign id is a 404 rather than a 403: a 403 would confirm the employee
  // exists somewhere.
  if (!employee) throw new NotFoundError("Employee");

  const workDate = toDateOnly(input.workDate);

  if (workDate > new Date()) {
    throw new ConflictError("A day cannot be entered before it has happened.");
  }
  if (workDate < employee.joinDate) {
    throw new ConflictError("That is before this employee joined.");
  }
  if (employee.exitDate && workDate > employee.exitDate) {
    throw new ConflictError("That is after this employee left.");
  }

  await assertMonthOpen(ctx, input.workDate);

  const entry = await ctx.db.attendanceCorrection.create({
    data: {
      companyId: ctx.companyId,
      employeeId: input.employeeId,
      workDate,
      requestedIn: input.checkIn ? new Date(input.checkIn) : null,
      requestedOut: input.checkOut ? new Date(input.checkOut) : null,
      requestedStatus: input.status ?? null,
      reason: input.reason,
      status: "approved",
      reviewedBy: ctx.userId,
      reviewedAt: new Date(),
      reviewNote: "Entered by HR",
    },
    select: CORRECTION_FIELDS,
  });

  const punches = [
    { at: input.checkIn, direction: "in" as const },
    { at: input.checkOut, direction: "out" as const },
  ].filter((p): p is { at: string; direction: "in" | "out" } => p.at != null);

  if (punches.length > 0) {
    await ctx.db.attendancePunch.createMany({
      data: punches.map((p) => ({
        companyId: ctx.companyId,
        employeeId: input.employeeId,
        punchedAt: new Date(p.at),
        direction: p.direction,
        source: "manual" as const,
        note: `Manual entry ${entry.id}`,
        createdBy: ctx.userId,
      })),
    });
  }

  await recomputeDay(ctx, input.employeeId, input.workDate);

  await emit(
    "attendance.manual_entry",
    {
      employeeId: input.employeeId,
      correctionId: entry.id,
      workDate: input.workDate,
      entered: {
        in: input.checkIn ?? null,
        out: input.checkOut ?? null,
        status: input.status ?? null,
      },
      reason: input.reason,
    },
    actor(ctx),
  );

  return present(entry);
}
