import type { RequestContext } from "@/lib/context";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope } from "@/lib/permissions";
import { fromDateOnly } from "@/lib/utils";
import { getSetting } from "@/modules/settings/service";

import { blockingTasks } from "./gate";
import { canAdvance, lastWorkingDay, planTasks, type OffboardingState } from "./rules";
import type {
  CancelExitInput,
  ConfirmExitInput,
  ListExitsInput,
  ResignInput,
  SettlementInput,
} from "./validators";

/**
 * Leaving, from resignation to a disabled account.
 *
 * The order is fixed and forward only: somebody resigns, their manager
 * approves, HR confirms the last working day and the exit checklist starts,
 * the required tasks are settled, the settlement is recorded, and only then
 * is the account closed.
 *
 * Withdrawal is allowed right up until the settlement is recorded. People
 * change their minds, and until money has moved there is nothing to undo.
 * After it, the way back is another payment, not a status change.
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

const REQUEST_FIELDS = {
  id: true,
  employeeId: true,
  reason: true,
  requestedLastWorkingDay: true,
  lastWorkingDay: true,
  status: true,
  approvedAt: true,
  confirmedAt: true,
  clearedAt: true,
  settledAt: true,
  completedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  leaveEncashmentDays: true,
  settlementNotes: true,
  createdAt: true,
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      managerId: true,
      designation: { select: { title: true } },
      department: { select: { name: true } },
    },
  },
} as const;

/**
 * Load an exit, and refuse to admit it exists to somebody with no part in it.
 *
 * 404 rather than 403 throughout: that a named colleague has resigned is
 * exactly the sort of thing a permission error would leak before anybody has
 * been told.
 */
async function loadForActor(ctx: RequestContext, id: string) {
  const request = await ctx.db.offboardingRequest.findFirst({
    where: { id },
    select: REQUEST_FIELDS,
  });
  if (!request) throw new NotFoundError("Resignation");

  const scope = resolveScope(ctx, "offboarding");
  const me = ctx.employeeId;
  const mine = me !== null && request.employeeId === me;
  const myReport = me !== null && request.employee.managerId === me;

  if (scope !== "all" && !mine && !(scope === "team" && myReport)) {
    throw new NotFoundError("Resignation");
  }
  return request;
}

function assertAdvance(from: string, to: OffboardingState) {
  if (!canAdvance(from as OffboardingState, to)) {
    throw new BusinessRuleError(`An exit at ${from} cannot move to ${to}.`, {
      rule: "invalid_exit_transition",
      from,
      to,
    });
  }
}

// ─────────────────────────────────────────────── resigning

/**
 * File a resignation.
 *
 * An employee files their own; HR may file on somebody's behalf, because
 * people resign in a corridor and somebody has to write it down.
 */
export async function resign(ctx: RequestContext, input: ResignInput) {
  const scope = resolveScope(ctx, "offboarding");
  const onBehalf = input.employeeId != null && input.employeeId !== ctx.employeeId;

  if (onBehalf && scope !== "all") {
    throw new ForbiddenError("offboarding.view_all");
  }

  const employeeId = input.employeeId ?? ctx.employeeId;
  if (!employeeId) {
    throw new BusinessRuleError("This account is not linked to an employee record.", {
      rule: "no_employee_record",
    });
  }

  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true, status: true, noticePeriodDays: true },
  });
  if (!employee) throw new NotFoundError("Employee");

  if (employee.status === "exited") {
    throw new BusinessRuleError("This employee has already left.", { rule: "employee_exited" });
  }

  const open = await ctx.db.offboardingRequest.findFirst({
    where: { employeeId, status: { notIn: ["completed", "cancelled"] } },
    select: { id: true },
  });
  if (open) {
    throw new BusinessRuleError("There is already a resignation in progress.", {
      rule: "exit_in_progress",
    });
  }

  const request = await ctx.db.offboardingRequest.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      reason: input.reason,
      requestedLastWorkingDay: fromDateOnly(input.requestedLastWorkingDay),
      submittedBy: ctx.userId,
    },
    select: REQUEST_FIELDS,
  });

  await emit("offboarding.submitted", { requestId: request.id, employeeId }, actor(ctx));
  return request;
}

/**
 * The manager's approval.
 *
 * It stamps the record without moving it along: HR still has to settle the
 * date, and a resignation nobody has dated is not yet a leaving date anybody
 * can plan around.
 */
export async function approveResignation(ctx: RequestContext, id: string) {
  const request = await loadForActor(ctx, id);

  if (request.status !== "initiated") {
    throw new BusinessRuleError("This resignation has already moved past approval.", {
      rule: "already_approved",
    });
  }
  if (request.employeeId === ctx.employeeId) {
    throw new BusinessRuleError("You cannot approve your own resignation.", {
      rule: "self_approval",
    });
  }

  const updated = await ctx.db.offboardingRequest.update({
    where: { id },
    data: { approvedBy: ctx.userId, approvedAt: new Date() },
    select: REQUEST_FIELDS,
  });

  await emit("offboarding.approved", { requestId: id, employeeId: request.employeeId }, actor(ctx));
  return updated;
}

/**
 * HR confirms, which is where the exit becomes real.
 *
 * The last working day is worked out from the notice period unless HR names
 * one — notice gets waived and extended all the time, and a computed date
 * nobody may override would just be worked around outside the system.
 *
 * Confirming starts the exit checklist and puts the person on notice, because
 * those three facts belong together: a date, a list of things to do before
 * it, and a status that tells the rest of the app what is happening.
 */
export async function confirmResignation(ctx: RequestContext, id: string, input: ConfirmExitInput) {
  const request = await loadForActor(ctx, id);
  assertAdvance(request.status, "in_progress");

  if (!request.approvedAt) {
    throw new BusinessRuleError("This resignation has not been approved yet.", {
      rule: "not_approved",
    });
  }

  const employee = await ctx.db.employee.findFirstOrThrow({
    where: { id: request.employeeId },
    select: { id: true, managerId: true, noticePeriodDays: true },
  });

  const companyDefault = await getSetting(ctx.db, ctx.companyId, "offboarding.notice_period_days");
  const noticeDays = employee.noticePeriodDays ?? companyDefault;

  const settled =
    input.lastWorkingDay ??
    lastWorkingDay(
      toDateOnly(request.createdAt) ?? today(),
      toDateOnly(request.requestedLastWorkingDay)!,
      noticeDays,
    );

  // The checklist, if the company wrote one. An exit is not blocked on
  // somebody having set up templates first.
  const template = await ctx.db.checklistTemplate.findFirst({
    where: {
      deletedAt: null,
      kind: "offboarding",
      ...(input.templateId ? { id: input.templateId } : { isDefault: true }),
    },
    select: {
      id: true,
      tasks: {
        select: {
          title: true,
          description: true,
          assignee: true,
          dueOffsetDays: true,
          isRequired: true,
          sortOrder: true,
        },
      },
    },
  });

  if (template) {
    const planned = planTasks(template.tasks, settled, {
      employeeId: employee.id,
      managerId: employee.managerId,
      hrId: ctx.employeeId ?? null,
      itId: input.itEmployeeId ?? null,
    });

    await ctx.db.checklistTask.createMany({
      data: planned.map((task) => ({
        companyId: ctx.companyId,
        kind: "offboarding" as const,
        employeeId: employee.id,
        offboardingRequestId: id,
        templateId: template.id,
        title: task.title,
        description: task.description ?? null,
        assignee: task.assignee,
        assignedToEmployeeId: task.assignedToEmployeeId,
        dueDate: fromDateOnly(task.dueDate),
        isRequired: task.isRequired,
        sortOrder: task.sortOrder,
      })),
    });
  }

  const updated = await ctx.db.offboardingRequest.update({
    where: { id },
    data: {
      status: "in_progress",
      lastWorkingDay: fromDateOnly(settled),
      confirmedBy: ctx.userId,
      confirmedAt: new Date(),
    },
    select: REQUEST_FIELDS,
  });

  await ctx.db.employee.update({
    where: { id: employee.id },
    data: { status: "on_notice" },
  });

  await emit(
    "offboarding.confirmed",
    { requestId: id, employeeId: employee.id, lastWorkingDay: settled },
    actor(ctx),
  );
  await emit(
    "employee.status_changed",
    { employeeId: employee.id, from: "active", to: "on_notice" },
    actor(ctx),
  );

  return updated;
}

/**
 * Everything handed back and handed over.
 *
 * Gated on the checklist, and the refusal names what is outstanding: an exit
 * held up by "return the laptop" should say so, not report a count.
 */
export async function markCleared(ctx: RequestContext, id: string) {
  const request = await loadForActor(ctx, id);
  assertAdvance(request.status, "cleared");

  const outstanding = await blockingTasks(ctx, request.employeeId, "offboarding");
  if (outstanding.length > 0) {
    throw new BusinessRuleError(`Not cleared yet: ${outstanding.join(", ")}.`, {
      rule: "exit_tasks_outstanding",
      outstanding,
    });
  }

  const updated = await ctx.db.offboardingRequest.update({
    where: { id },
    data: { status: "cleared", clearedAt: new Date() },
    select: REQUEST_FIELDS,
  });

  await emit("offboarding.cleared", { requestId: id, employeeId: request.employeeId }, actor(ctx));
  return updated;
}

/**
 * What is owed, written down.
 *
 * Recorded rather than calculated. Payroll does not exist yet, and a figure
 * this module invented would be a number somebody might act on — so what is
 * captured is the input a settlement run will need, and the arithmetic waits
 * for the module that owns it.
 */
export async function recordSettlement(ctx: RequestContext, id: string, input: SettlementInput) {
  const request = await loadForActor(ctx, id);
  assertAdvance(request.status, "settled");

  const updated = await ctx.db.offboardingRequest.update({
    where: { id },
    data: {
      status: "settled",
      settledAt: new Date(),
      leaveEncashmentDays: input.leaveEncashmentDays ?? null,
      settlementNotes: input.settlementNotes ?? null,
    },
    select: REQUEST_FIELDS,
  });

  await emit("offboarding.settled", { requestId: id, employeeId: request.employeeId }, actor(ctx));
  return updated;
}

/**
 * The last step: the person leaves and the account closes.
 *
 * The session version is bumped as well as the account disabled, so a browser
 * they left signed in somewhere stops working now rather than whenever the
 * cookie would have expired.
 */
export async function completeExit(ctx: RequestContext, id: string) {
  const request = await loadForActor(ctx, id);
  assertAdvance(request.status, "completed");

  const employee = await ctx.db.employee.findFirstOrThrow({
    where: { id: request.employeeId },
    select: { id: true, status: true, userId: true },
  });

  const updated = await ctx.db.offboardingRequest.update({
    where: { id },
    data: { status: "completed", completedAt: new Date() },
    select: REQUEST_FIELDS,
  });

  await ctx.db.employee.update({
    where: { id: employee.id },
    data: { status: "exited", exitDate: request.lastWorkingDay },
  });

  if (employee.userId) {
    await ctx.db.user.update({
      where: { id: employee.userId },
      data: { status: "disabled", sessionVersion: { increment: 1 } },
    });
    await emit("user.disabled", { userId: employee.userId }, actor(ctx));
  }

  await emit(
    "employee.status_changed",
    { employeeId: employee.id, from: employee.status, to: "exited" },
    actor(ctx),
  );
  await emit("offboarding.completed", { requestId: id, employeeId: employee.id }, actor(ctx));

  return updated;
}

/**
 * Withdrawing a resignation.
 *
 * The row is kept and marked cancelled rather than deleted — that somebody
 * resigned and thought better of it is a fact about the year, and erasing it
 * would take the reason with it. Their outstanding exit tasks go, because
 * they are no longer leaving and a stale checklist would keep chasing them.
 */
export async function cancelExit(ctx: RequestContext, id: string, input: CancelExitInput) {
  const request = await loadForActor(ctx, id);
  assertAdvance(request.status, "cancelled");

  const updated = await ctx.db.offboardingRequest.update({
    where: { id },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      cancellationReason: input.cancellationReason,
    },
    select: REQUEST_FIELDS,
  });

  await ctx.db.checklistTask.deleteMany({
    where: { offboardingRequestId: id, status: "pending" },
  });

  await ctx.db.employee.updateMany({
    where: { id: request.employeeId, status: "on_notice" },
    data: { status: "active" },
  });

  await emit(
    "offboarding.cancelled",
    { requestId: id, employeeId: request.employeeId },
    actor(ctx),
  );
  return updated;
}

// ─────────────────────────────────────────────── reading

export async function listExits(ctx: RequestContext, input: ListExitsInput) {
  const scope = resolveScope(ctx, "offboarding");
  const me = ctx.employeeId ?? "";

  const where: Record<string, unknown> = input.status ? { status: input.status } : {};

  if (input.mine) {
    // Asked for explicitly, so scope does not widen it.
    where["employeeId"] = me;
  } else if (scope === "team") {
    where["OR"] = [{ employeeId: me }, { employee: { managerId: me } }];
  } else if (scope !== "all") {
    where["employeeId"] = me;
  }

  return ctx.db.offboardingRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: REQUEST_FIELDS,
  });
}

export async function getExit(ctx: RequestContext, id: string) {
  return loadForActor(ctx, id);
}

/** The open exit for one person, if there is one. */
export async function exitForEmployee(ctx: RequestContext, employeeId: string) {
  const request = await ctx.db.offboardingRequest.findFirst({
    where: { employeeId, status: { notIn: ["cancelled"] } },
    orderBy: { createdAt: "desc" },
    select: REQUEST_FIELDS,
  });
  if (!request) return null;
  return loadForActor(ctx, request.id);
}
