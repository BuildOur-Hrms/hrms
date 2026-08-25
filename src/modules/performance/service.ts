import type { RequestContext } from "@/lib/context";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope } from "@/lib/permissions";
import { fromDateOnly } from "@/lib/utils";

import {
  canMoveCycle,
  canMoveReview,
  goalProgress,
  goalsAreOpen,
  reviewsAreOpen,
  tallyCycle,
  type CycleStatus,
  type ReviewStatus,
} from "./rules";
import type {
  AddGoalInput,
  CreateCycleInput,
  CycleStatusInput,
  FinalRatingInput,
  ListCyclesInput,
  ListReviewsInput,
  ManagerReviewInput,
  ReopenReviewInput,
  SelfReviewInput,
} from "./validators";

/**
 * Performance, connected to the database.
 *
 * The rule that shapes everything here: a review belongs to two people, and
 * neither of them may write the other's half. An employee rates themselves, a
 * manager rates them, and HR settles the number that goes on the record. Each
 * of those is checked against the row rather than against a permission alone,
 * because "manager" is a relationship, not a rank.
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

const CYCLE_FIELDS = {
  id: true,
  name: true,
  periodStart: true,
  periodEnd: true,
  reviewDeadline: true,
  status: true,
} as const;

const REVIEW_FIELDS = {
  id: true,
  cycleId: true,
  employeeId: true,
  managerId: true,
  status: true,
  selfRating: true,
  selfComments: true,
  selfSubmittedAt: true,
  managerRating: true,
  managerComments: true,
  managerSubmittedAt: true,
  finalRating: true,
  cycle: { select: { id: true, name: true, status: true, reviewDeadline: true } },
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      designation: { select: { title: true } },
      department: { select: { name: true } },
    },
  },
} as const;

// ─────────────────────────────────────────────── cycles

export async function listCycles(ctx: RequestContext, input: ListCyclesInput) {
  return ctx.db.performanceCycle.findMany({
    where: input.status ? { status: input.status } : {},
    orderBy: { periodStart: "desc" },
    select: { ...CYCLE_FIELDS, _count: { select: { reviews: true } } },
  });
}

export async function createCycle(ctx: RequestContext, input: CreateCycleInput) {
  const cycle = await ctx.db.performanceCycle.create({
    data: {
      companyId: ctx.companyId,
      name: input.name,
      periodStart: fromDateOnly(input.periodStart),
      periodEnd: fromDateOnly(input.periodEnd),
      reviewDeadline: input.reviewDeadline ? fromDateOnly(input.reviewDeadline) : null,
    },
    select: CYCLE_FIELDS,
  });

  await emit("performance.cycle_created", { cycleId: cycle.id, name: cycle.name }, actor(ctx));
  return cycle;
}

/**
 * Move a cycle to its next stage.
 *
 * Opening reviews is the step that does real work: it creates one review per
 * active employee, against whoever their manager is at that moment. Doing it
 * here rather than lazily means the completion matrix is answerable straight
 * away — "nobody has started" and "nothing exists yet" look identical
 * otherwise.
 */
export async function setCycleStatus(ctx: RequestContext, id: string, input: CycleStatusInput) {
  const cycle = await ctx.db.performanceCycle.findFirst({
    where: { id },
    select: { id: true, status: true },
  });
  if (!cycle) throw new NotFoundError("Cycle");

  if (cycle.status === input.status) return { id, status: input.status, opened: 0 };

  if (!canMoveCycle(cycle.status as CycleStatus, input.status)) {
    throw new BusinessRuleError(`A cycle at ${cycle.status} cannot move to ${input.status}.`, {
      rule: "invalid_cycle_transition",
      from: cycle.status,
      to: input.status,
    });
  }

  let opened = 0;
  if (input.status === "review") {
    const employees = await ctx.db.employee.findMany({
      where: { status: { in: ["active", "on_notice"] }, deletedAt: null },
      select: { id: true, managerId: true },
    });

    const existing = await ctx.db.performanceReview.findMany({
      where: { cycleId: id },
      select: { employeeId: true },
    });
    const already = new Set(existing.map((row) => row.employeeId));

    const fresh = employees.filter((employee) => !already.has(employee.id));
    if (fresh.length > 0) {
      await ctx.db.performanceReview.createMany({
        data: fresh.map((employee) => ({
          companyId: ctx.companyId,
          cycleId: id,
          employeeId: employee.id,
          managerId: employee.managerId,
        })),
      });
    }
    opened = fresh.length;
  }

  await ctx.db.performanceCycle.update({ where: { id }, data: { status: input.status } });

  await emit(
    "performance.cycle_status_changed",
    { cycleId: id, from: cycle.status, to: input.status, opened },
    actor(ctx),
  );

  return { id, status: input.status, opened };
}

/** How a cycle is going, and how the ratings fell across it. */
export async function cycleSummary(ctx: RequestContext, id: string) {
  if (resolveScope(ctx, "performance") !== "all") throw new ForbiddenError("performance.view_all");

  const cycle = await ctx.db.performanceCycle.findFirst({
    where: { id },
    select: CYCLE_FIELDS,
  });
  if (!cycle) throw new NotFoundError("Cycle");

  const reviews = await ctx.db.performanceReview.findMany({
    where: { cycleId: id },
    select: { status: true, finalRating: true },
  });

  return { cycle, tally: tallyCycle(reviews as never) };
}

// ─────────────────────────────────────────────── goals

/**
 * Propose a goal against a cycle.
 *
 * A goal is a job task with a cycle on it, so everything already true of
 * tasks stays true: the person owns the progress, whoever set it owns the
 * weight, and it is left out of the monthly figure.
 */
export async function addGoal(ctx: RequestContext, cycleId: string, input: AddGoalInput) {
  const cycle = await ctx.db.performanceCycle.findFirst({
    where: { id: cycleId },
    select: { id: true, status: true, periodStart: true },
  });
  if (!cycle) throw new NotFoundError("Cycle");

  if (!goalsAreOpen(cycle.status as CycleStatus)) {
    throw new BusinessRuleError("Goals are closed for this cycle.", { rule: "goals_closed" });
  }

  const scope = resolveScope(ctx, "performance");
  const forSomebodyElse = input.employeeId != null && input.employeeId !== ctx.employeeId;

  if (forSomebodyElse && scope !== "all" && scope !== "team") {
    throw new ForbiddenError("performance.view_team");
  }

  const employeeId = input.employeeId ?? ctx.employeeId;
  if (!employeeId) {
    throw new BusinessRuleError("This account is not linked to an employee record.", {
      rule: "no_employee_record",
    });
  }

  if (forSomebodyElse && scope === "team") {
    const report = await ctx.db.employee.findFirst({
      where: { id: employeeId, managerId: ctx.employeeId ?? "" },
      select: { id: true },
    });
    if (!report) throw new NotFoundError("Employee");
  }

  // The month a goal counts towards is the month its cycle begins. It is
  // never read for the monthly figures — those skip goals — but the column
  // is not nullable and a wrong-looking value invites somebody to trust it.
  const anchor = cycle.periodStart;

  const goal = await ctx.db.jobTask.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      createdBy: ctx.userId,
      origin: forSomebodyElse ? "assigned" : "self",
      title: input.title,
      description: input.description ?? null,
      weight: input.weight,
      cycleId,
      year: anchor.getUTCFullYear(),
      month: anchor.getUTCMonth() + 1,
      dueDate: input.dueDate ? fromDateOnly(input.dueDate) : null,
    },
    select: { id: true, title: true, employeeId: true },
  });

  await emit(
    "performance.goal_added",
    { goalId: goal.id, cycleId, employeeId: goal.employeeId },
    actor(ctx),
  );
  return goal;
}

/**
 * A manager agreeing somebody's goal set.
 *
 * The whole set at once, because that is the conversation: goals are agreed
 * together or not at all, and approving them one at a time would suggest
 * otherwise.
 */
export async function approveGoals(ctx: RequestContext, cycleId: string, employeeId: string) {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true, managerId: true },
  });
  if (!employee) throw new NotFoundError("Employee");

  /*
   * Self first, then scope.
   *
   * Nobody is their own manager, so checking scope first told somebody trying
   * to agree their own goals that the employee did not exist — which is both
   * untrue and unhelpful, since they are looking at themselves.
   */
  if (employeeId === ctx.employeeId) {
    throw new BusinessRuleError("You cannot approve your own goals.", { rule: "self_approval" });
  }

  const scope = resolveScope(ctx, "performance");
  const isTheirManager = employee.managerId === ctx.employeeId;
  if (scope !== "all" && !isTheirManager) throw new NotFoundError("Employee");

  const result = await ctx.db.jobTask.updateMany({
    where: { cycleId, employeeId, approvedAt: null },
    data: { approvedBy: ctx.userId, approvedAt: new Date() },
  });

  if (result.count === 0) {
    throw new BusinessRuleError("There are no goals waiting to be agreed.", {
      rule: "nothing_to_approve",
    });
  }

  await emit(
    "performance.goals_approved",
    { cycleId, employeeId, count: result.count },
    actor(ctx),
  );
  return { cycleId, employeeId, approved: result.count };
}

/** One person's goals for a cycle, with how far through the set they are. */
export async function goalsFor(ctx: RequestContext, cycleId: string, employeeId: string) {
  const goals = await ctx.db.jobTask.findMany({
    where: { cycleId, employeeId },
    orderBy: [{ weight: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      weight: true,
      progress: true,
      status: true,
      dueDate: true,
      origin: true,
      approvedAt: true,
    },
  });

  return {
    goals,
    progress: goalProgress(goals),
    // Agreed as a set, so one unapproved goal means the set is unapproved.
    approved: goals.length > 0 && goals.every((goal) => goal.approvedAt !== null),
  };
}

// ─────────────────────────────────────────────── reviews

async function loadReview(ctx: RequestContext, id: string) {
  const review = await ctx.db.performanceReview.findFirst({
    where: { id },
    select: REVIEW_FIELDS,
  });
  if (!review) throw new NotFoundError("Review");

  const scope = resolveScope(ctx, "performance");
  const me = ctx.employeeId;
  const mine = me !== null && review.employeeId === me;
  const theirs = me !== null && review.managerId === me;

  if (scope !== "all" && !mine && !theirs) throw new NotFoundError("Review");
  return review;
}

export async function listReviews(ctx: RequestContext, input: ListReviewsInput) {
  const scope = resolveScope(ctx, "performance");
  const me = ctx.employeeId ?? "";

  const where: Record<string, unknown> = {
    ...(input.cycleId ? { cycleId: input.cycleId } : {}),
  };

  if (input.mine) {
    where["employeeId"] = me;
  } else if (input.toWrite) {
    where["managerId"] = me;
  } else if (scope === "all") {
    if (input.employeeId) where["employeeId"] = input.employeeId;
  } else if (scope === "team") {
    where["OR"] = [{ employeeId: me }, { managerId: me }];
  } else {
    where["employeeId"] = me;
  }

  return ctx.db.performanceReview.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 500,
    select: REVIEW_FIELDS,
  });
}

export async function getReview(ctx: RequestContext, id: string) {
  const review = await loadReview(ctx, id);
  const goals = await goalsFor(ctx, review.cycleId, review.employeeId);
  return { ...review, ...goals };
}

function assertCycleTakesReviews(status: string) {
  if (!reviewsAreOpen(status as CycleStatus)) {
    throw new BusinessRuleError("This cycle is not open for reviews.", {
      rule: "reviews_closed",
      cycleStatus: status,
    });
  }
}

/**
 * The employee's half.
 *
 * Only ever written by the person it is about — a manager filling in somebody
 * else's self review is not a self review, and there is no permission that
 * should make it one.
 */
export async function submitSelfReview(ctx: RequestContext, id: string, input: SelfReviewInput) {
  const review = await loadReview(ctx, id);
  assertCycleTakesReviews(review.cycle.status);

  if (review.employeeId !== ctx.employeeId) {
    throw new BusinessRuleError("A self review is written by the person it is about.", {
      rule: "not_your_review",
    });
  }
  if (!canMoveReview(review.status as ReviewStatus, "pending_manager")) {
    throw new BusinessRuleError("This review has already been submitted.", {
      rule: "already_submitted",
    });
  }

  const updated = await ctx.db.performanceReview.update({
    where: { id },
    data: {
      selfRating: input.rating,
      selfComments: input.comments,
      selfSubmittedAt: new Date(),
      status: "pending_manager",
    },
    select: REVIEW_FIELDS,
  });

  await emit(
    "performance.self_submitted",
    { reviewId: id, employeeId: review.employeeId },
    actor(ctx),
  );
  return updated;
}

/**
 * The manager's half.
 *
 * Written by the manager the review was opened against, not by whoever
 * happens to manage the person today. Somebody who changed teams mid-cycle is
 * still reviewed by the person who watched them work.
 */
export async function submitManagerReview(
  ctx: RequestContext,
  id: string,
  input: ManagerReviewInput,
) {
  const review = await loadReview(ctx, id);
  assertCycleTakesReviews(review.cycle.status);

  const scope = resolveScope(ctx, "performance");
  const isTheirManager = review.managerId === ctx.employeeId;
  if (!isTheirManager && scope !== "all") {
    throw new BusinessRuleError("This review belongs to somebody else's manager.", {
      rule: "not_their_manager",
    });
  }
  if (review.employeeId === ctx.employeeId) {
    throw new BusinessRuleError("You cannot write the manager half of your own review.", {
      rule: "self_review",
    });
  }
  if (!canMoveReview(review.status as ReviewStatus, "completed")) {
    throw new BusinessRuleError(
      review.status === "pending_self"
        ? "They have not submitted their self review yet."
        : "This review is already complete.",
      { rule: "review_not_ready", status: review.status },
    );
  }

  const updated = await ctx.db.performanceReview.update({
    where: { id },
    data: {
      managerRating: input.rating,
      managerComments: input.comments,
      managerSubmittedAt: new Date(),
      status: "completed",
      // A starting point for calibration, not the last word: HR may move it.
      finalRating: review.finalRating ?? input.rating,
    },
    select: REVIEW_FIELDS,
  });

  await emit(
    "performance.manager_submitted",
    { reviewId: id, employeeId: review.employeeId },
    actor(ctx),
  );
  return updated;
}

/** HR settling the number that goes on the record. */
export async function setFinalRating(ctx: RequestContext, id: string, input: FinalRatingInput) {
  const review = await loadReview(ctx, id);

  if (review.cycle.status === "closed") {
    throw new BusinessRuleError("This cycle is closed.", { rule: "cycle_closed" });
  }
  if (review.status !== "completed") {
    throw new BusinessRuleError("The review is not finished yet.", { rule: "review_unfinished" });
  }

  const updated = await ctx.db.performanceReview.update({
    where: { id },
    data: { finalRating: input.finalRating ?? null },
    select: REVIEW_FIELDS,
  });

  await emit(
    "performance.final_rating_set",
    { reviewId: id, employeeId: review.employeeId, rating: input.finalRating ?? null },
    actor(ctx),
  );
  return updated;
}

/**
 * Sending a review back.
 *
 * For the manager who rated the wrong person and the employee who submitted
 * by accident. Refused once the cycle is closed, because at that point the
 * ratings have been read.
 */
export async function reopenReview(ctx: RequestContext, id: string, input: ReopenReviewInput) {
  const review = await loadReview(ctx, id);

  if (review.cycle.status === "closed") {
    throw new BusinessRuleError("This cycle is closed.", { rule: "cycle_closed" });
  }
  if (!canMoveReview(review.status as ReviewStatus, input.to)) {
    throw new BusinessRuleError(`A review at ${review.status} cannot go back to ${input.to}.`, {
      rule: "invalid_review_transition",
      from: review.status,
      to: input.to,
    });
  }

  const updated = await ctx.db.performanceReview.update({
    where: { id },
    data: {
      status: input.to,
      // The half being rewritten is cleared, so a stale rating cannot sit
      // under a status that says it has not been given.
      ...(input.to === "pending_self"
        ? { selfRating: null, selfComments: null, selfSubmittedAt: null }
        : {}),
      ...(input.to === "pending_manager"
        ? { managerRating: null, managerComments: null, managerSubmittedAt: null }
        : {}),
    },
    select: REVIEW_FIELDS,
  });

  await emit(
    "performance.review_reopened",
    { reviewId: id, employeeId: review.employeeId, to: input.to },
    actor(ctx),
  );
  return updated;
}
