import type { RequestContext } from "@/lib/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope } from "@/lib/permissions";
import { effectiveShift } from "@/modules/shifts/service";

import { currentBalance, hasSufficientBalance, round2 } from "./accrual";
import { ensureBalance } from "./balances";
import { countLeaveDays } from "./day-count";
import { holidayDatesFor } from "./holidays";
import { policyFor } from "./types";
import type { CreateLeaveRequestInput, LeaveListInput, LeaveReviewInput } from "./validators";

/**
 * The leave request lifecycle.
 *
 * The balance moves on approval, not on submission — a pending request that
 * nobody ever actions must not quietly hold days hostage. Sufficiency is
 * therefore checked twice: at submit, so the employee finds out immediately,
 * and again at approval, because the balance can move in between.
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const REQUEST_FIELDS = {
  id: true,
  startDate: true,
  endDate: true,
  halfDay: true,
  days: true,
  reason: true,
  status: true,
  reviewedAt: true,
  reviewNote: true,
  leaveType: { select: { id: true, name: true, code: true, color: true, isPaid: true } },
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
} as const;

type RequestRow = { startDate: Date; endDate: Date; days: unknown } & Record<string, unknown>;

function present<T extends RequestRow>(row: T) {
  return {
    ...row,
    startDate: isoDate(row.startDate),
    endDate: isoDate(row.endDate),
    days: Number(row.days),
  };
}

function ownEmployeeId(ctx: RequestContext): string {
  if (!ctx.employeeId) {
    throw new ConflictError("This account has no employee record, so it cannot request leave.");
  }
  return ctx.employeeId;
}

/**
 * Work out what a span costs for one employee.
 *
 * Pulls the two things the pure counter cannot know — which weekdays are off
 * for their shift, and which dates are holidays at their location — and hands
 * them over.
 */
async function priceRequest(
  ctx: RequestContext,
  employeeId: string,
  leaveTypeId: string,
  input: { startDate: string; endDate: string; halfDay: "none" | "first_half" | "second_half" },
) {
  const [shift, holidays, policy] = await Promise.all([
    effectiveShift(ctx, employeeId, toDateOnly(input.startDate)),
    holidayDatesFor(ctx, employeeId, input.startDate, input.endDate),
    policyFor(ctx, leaveTypeId),
  ]);

  const counted = countLeaveDays({
    startDate: input.startDate,
    endDate: input.endDate,
    halfDay: input.halfDay,
    weekOffDays: shift?.weekOffDays ?? [0, 6],
    holidays,
    sandwichRule: policy.sandwichRule,
  });

  return { counted, policy };
}

/** What a span would cost, without committing to it — for the apply form. */
export async function quoteRequest(
  ctx: RequestContext,
  leaveTypeId: string,
  input: { startDate: string; endDate: string; halfDay: "none" | "first_half" | "second_half" },
) {
  const employeeId = ownEmployeeId(ctx);
  const { counted } = await priceRequest(ctx, employeeId, leaveTypeId, input);
  return { days: counted.days, breakdown: counted.breakdown };
}

export async function createLeaveRequest(ctx: RequestContext, input: CreateLeaveRequestInput) {
  const employeeId = ownEmployeeId(ctx);

  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true, managerId: true, probationEndDate: true },
  });
  if (!employee) throw new NotFoundError("Employee");

  const leaveType = await ctx.db.leaveType.findFirst({
    where: { id: input.leaveTypeId },
    select: { id: true, requiresAttachment: true },
  });
  if (!leaveType) throw new NotFoundError("Leave type");

  const { counted, policy } = await priceRequest(ctx, employeeId, input.leaveTypeId, input);

  if (counted.days <= 0) {
    throw new ValidationError("That span is entirely holidays and week-offs", {
      startDate: ["There are no working days in this range."],
    });
  }

  if (policy.maxConsecutiveDays && counted.days > policy.maxConsecutiveDays) {
    throw new ValidationError("That is longer than this leave type allows", {
      endDate: [`At most ${policy.maxConsecutiveDays} days at a time.`],
    });
  }

  if (policy.minNoticeDays > 0) {
    const noticeDays = Math.round(
      (toDateOnly(input.startDate).getTime() - toDateOnly(today()).getTime()) / 86_400_000,
    );
    if (noticeDays < policy.minNoticeDays) {
      throw new ValidationError("That is shorter notice than this leave type allows", {
        startDate: [`Needs ${policy.minNoticeDays} days notice.`],
      });
    }
  }

  if (policy.applicableAfterProbation && employee.probationEndDate) {
    if (toDateOnly(input.startDate) <= employee.probationEndDate) {
      throw new ConflictError("This leave type is only available after probation ends.");
    }
  }

  if (leaveType.requiresAttachment && !input.attachmentKey) {
    throw new ValidationError("This leave type needs a document", {
      attachmentKey: ["Attach the supporting document."],
    });
  }

  // Overlap is checked against pending and approved alike: a pending request
  // is a claim on those dates even before anyone has agreed to it.
  const overlap = await ctx.db.leaveRequest.findFirst({
    where: {
      employeeId,
      status: { in: ["pending", "approved"] },
      startDate: { lte: toDateOnly(input.endDate) },
      endDate: { gte: toDateOnly(input.startDate) },
    },
    select: { id: true, startDate: true, endDate: true },
  });
  if (overlap) {
    throw new ConflictError(
      `You already have leave booked from ${isoDate(overlap.startDate)} to ${isoDate(overlap.endDate)}.`,
    );
  }

  const year = Number(input.startDate.slice(0, 4));
  await assertSufficient(
    ctx,
    employeeId,
    input.leaveTypeId,
    year,
    counted.days,
    policy.maxNegative,
  );

  const created = await ctx.db.leaveRequest.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      leaveTypeId: input.leaveTypeId,
      startDate: toDateOnly(input.startDate),
      endDate: toDateOnly(input.endDate),
      halfDay: input.halfDay,
      days: counted.days,
      reason: input.reason,
      attachmentKey: input.attachmentKey ?? null,
      // Resolved now, so a later reorg does not move a pending request to
      // somebody who never saw it.
      approverId: employee.managerId,
    },
    select: REQUEST_FIELDS,
  });

  await emit(
    "leave.requested",
    {
      employeeId,
      requestId: created.id,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      days: counted.days,
    },
    actor(ctx),
  );

  return present(created);
}

async function assertSufficient(
  ctx: RequestContext,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  days: number,
  maxNegative: number,
) {
  const balance = await ctx.db.leaveBalance.findFirst({
    where: { employeeId, leaveTypeId, year },
    select: { opening: true, accrued: true, used: true, carriedForward: true, adjusted: true },
  });

  const current = balance
    ? currentBalance({
        opening: Number(balance.opening),
        accrued: Number(balance.accrued),
        used: Number(balance.used),
        carriedForward: Number(balance.carriedForward),
        adjusted: Number(balance.adjusted),
      })
    : 0;

  if (!hasSufficientBalance(current, days, maxNegative)) {
    throw new ConflictError(
      `Not enough balance: ${current} day${current === 1 ? "" : "s"} available, ${days} requested.`,
    );
  }
}

/**
 * Approve or reject.
 *
 * Balance moves here and only here. Sufficiency is re-checked because the
 * balance can have moved since submission — another request approved first,
 * or an HR adjustment — and approving into a shortfall is how a balance goes
 * negative without anyone deciding it should.
 */
export async function reviewLeaveRequest(ctx: RequestContext, id: string, input: LeaveReviewInput) {
  if (!ctx.permissions.has("leave.approve")) {
    throw new ForbiddenError("You cannot review leave requests");
  }

  const request = await ctx.db.leaveRequest.findFirst({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      leaveTypeId: true,
      startDate: true,
      days: true,
      status: true,
      employee: { select: { managerId: true } },
    },
  });
  if (!request) throw new NotFoundError("Leave request");

  if (request.employeeId === ctx.employeeId) {
    throw new ForbiddenError("You cannot review your own leave request");
  }
  if (request.status !== "pending") {
    throw new ConflictError(`This request is already ${request.status}.`);
  }

  const companyWide = ctx.permissions.has("leave.view_all") || ctx.permissions.has("leave.manage");
  if (!companyWide && request.employee.managerId !== ctx.employeeId) {
    throw new ForbiddenError("You can only review leave for your own team");
  }

  const days = Number(request.days);
  const year = request.startDate.getUTCFullYear();

  if (input.decision === "approved") {
    const policy = await policyFor(ctx, request.leaveTypeId);
    await assertSufficient(
      ctx,
      request.employeeId,
      request.leaveTypeId,
      year,
      days,
      policy.maxNegative,
    );

    const balanceId = await ensureBalance(ctx, request.employeeId, request.leaveTypeId, year);
    const before = await ctx.db.leaveBalance.findFirstOrThrow({
      where: { id: balanceId },
      select: { used: true },
    });
    await ctx.db.leaveBalance.update({
      where: { id: balanceId },
      data: { used: round2(Number(before.used) + days) },
    });
  }

  const updated = await ctx.db.leaveRequest.update({
    where: { id },
    data: {
      status: input.decision,
      reviewedBy: ctx.userId,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote ?? null,
    },
    select: REQUEST_FIELDS,
  });

  await emit(
    "leave.reviewed",
    {
      employeeId: request.employeeId,
      requestId: id,
      decision: input.decision,
      days,
    },
    actor(ctx),
  );

  return present(updated);
}

/**
 * Withdraw a request.
 *
 * An employee may cancel their own while it is pending, or after approval up
 * to the day it starts — cancelling leave you have already taken is not a
 * cancellation. HR may cancel at any point, which is the override that exists
 * because reality does not always follow the workflow.
 */
export async function cancelLeaveRequest(ctx: RequestContext, id: string) {
  const request = await ctx.db.leaveRequest.findFirst({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      leaveTypeId: true,
      startDate: true,
      days: true,
      status: true,
    },
  });
  if (!request) throw new NotFoundError("Leave request");

  const isOwn = request.employeeId === ctx.employeeId;
  const isHr = ctx.permissions.has("leave.manage");
  if (!isOwn && !isHr) throw new NotFoundError("Leave request");

  if (request.status === "cancelled" || request.status === "rejected") {
    throw new ConflictError(`This request is already ${request.status}.`);
  }

  if (request.status === "approved" && !isHr) {
    if (isoDate(request.startDate) <= today()) {
      throw new ConflictError(
        "This leave has already started. Ask HR to cancel it on your behalf.",
      );
    }
  }

  // Only an approved request has taken days out of the balance, so only an
  // approved one puts them back.
  if (request.status === "approved") {
    const year = request.startDate.getUTCFullYear();
    const balanceId = await ensureBalance(ctx, request.employeeId, request.leaveTypeId, year);
    const before = await ctx.db.leaveBalance.findFirstOrThrow({
      where: { id: balanceId },
      select: { used: true },
    });
    await ctx.db.leaveBalance.update({
      where: { id: balanceId },
      data: { used: round2(Math.max(0, Number(before.used) - Number(request.days))) },
    });
  }

  const updated = await ctx.db.leaveRequest.update({
    where: { id },
    data: { status: "cancelled" },
    select: REQUEST_FIELDS,
  });

  await emit(
    "leave.cancelled",
    {
      employeeId: request.employeeId,
      requestId: id,
      restored: request.status === "approved" ? Number(request.days) : 0,
    },
    actor(ctx),
  );

  return present(updated);
}

export async function listLeaveRequests(ctx: RequestContext, input: LeaveListInput) {
  const where: Record<string, unknown> = {};
  if (input.status) where["status"] = input.status;
  if (input.year) {
    where["startDate"] = {
      gte: new Date(Date.UTC(input.year, 0, 1)),
      lt: new Date(Date.UTC(input.year + 1, 0, 1)),
    };
  }

  if (input.scope === "mine") {
    where["employeeId"] = ownEmployeeId(ctx);
  } else if (input.scope === "all") {
    if (!ctx.permissions.has("leave.view_all") && !ctx.permissions.has("leave.manage")) {
      throw new ForbiddenError("You cannot see company-wide leave");
    }
  } else {
    if (resolveScope(ctx, "leave") === "own" || resolveScope(ctx, "leave") === "none") {
      throw new ForbiddenError("You cannot see team leave");
    }
    const companyWide =
      ctx.permissions.has("leave.view_all") || ctx.permissions.has("leave.manage");
    if (!companyWide) {
      // A manager's queue is their reports, never themselves — they cannot
      // action their own request, so showing it offers a button that fails.
      where["employee"] = { managerId: ctx.employeeId ?? "00000000-0000-0000-0000-000000000000" };
    }
  }

  const rows = await ctx.db.leaveRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    take: 200,
    select: REQUEST_FIELDS,
  });

  return rows.map(present);
}
