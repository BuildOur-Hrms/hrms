/**
 * What a review cycle allows, with nothing to connect to.
 *
 * Two state machines and a rating scale. The interesting part is that neither
 * machine is linear in the way it first looks: a cycle can be reopened from
 * review back to active, and a review can be sent back to the person who
 * wrote it — both because "we ran the cycle a week early" is a thing that
 * happens, and a system that cannot cope with it gets worked around in email.
 */

export type CycleStatus = "draft" | "active" | "review" | "closed";
export type ReviewStatus = "pending_self" | "pending_manager" | "completed";

/** The scale. Fixed at 1–5; only the labels are a company's to choose. */
export const RATINGS = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];

export const DEFAULT_RATING_LABELS: Record<Rating, string> = {
  1: "Well below",
  2: "Below",
  3: "Met expectations",
  4: "Above",
  5: "Well above",
};

export function isRating(value: number): value is Rating {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * Where a cycle may go next.
 *
 * `review → active` exists on purpose. Opening reviews before everyone has
 * agreed their goals is a common mistake, and the only alternative to
 * reversing it is closing the cycle and starting another.
 */
export const CYCLE_NEXT: Record<CycleStatus, readonly CycleStatus[]> = {
  draft: ["active"],
  active: ["review", "closed"],
  review: ["active", "closed"],
  closed: [],
};

export function canMoveCycle(from: CycleStatus, to: CycleStatus): boolean {
  return CYCLE_NEXT[from].includes(to);
}

/** Whether goals may still be proposed or changed. */
export function goalsAreOpen(status: CycleStatus): boolean {
  return status === "draft" || status === "active";
}

/** Whether reviews may be written. */
export function reviewsAreOpen(status: CycleStatus): boolean {
  return status === "review";
}

/**
 * Where a review may go next.
 *
 * Forward by submitting, and backward by HR sending it back — a manager who
 * rated the wrong person needs a way to fix it that is not a database edit.
 * Nothing moves once the cycle closes, which is enforced separately, because
 * that is a fact about the cycle rather than about the review.
 */
export const REVIEW_NEXT: Record<ReviewStatus, readonly ReviewStatus[]> = {
  pending_self: ["pending_manager"],
  pending_manager: ["completed", "pending_self"],
  completed: ["pending_manager"],
};

export function canMoveReview(from: ReviewStatus, to: ReviewStatus): boolean {
  return REVIEW_NEXT[from].includes(to);
}

export interface GoalLike {
  weight: number;
  progress: number;
  status: string;
}

/**
 * How far through a goal set somebody is.
 *
 * Weighted the same way the monthly task figure is, and for the same reason:
 * a goal weighted 5 that is untouched should not be offset by three trivial
 * ones that are done. Cancelled goals are left out entirely rather than
 * counted as zero — a goal that was called off is not a goal that was missed.
 */
export function goalProgress(goals: GoalLike[]): number {
  const live = goals.filter((goal) => goal.status !== "cancelled");
  const total = live.reduce((sum, goal) => sum + Math.max(goal.weight, 0), 0);
  if (total === 0) return 0;

  const done = live.reduce((sum, goal) => sum + Math.max(goal.weight, 0) * goal.progress, 0);
  return Math.round(done / total);
}

export interface ReviewLike {
  status: ReviewStatus;
  finalRating: number | null;
}

export interface CycleTally {
  total: number;
  awaitingSelf: number;
  awaitingManager: number;
  completed: number;
  rated: number;
  /** Mean of the final ratings, to one decimal. Null while none are set. */
  averageFinal: number | null;
  distribution: Record<Rating, number>;
}

/**
 * How a cycle is going, and how the ratings fell.
 *
 * The distribution is the part HR actually uses: a department where everybody
 * scored 4 has not been calibrated, and the only way to see that is to look
 * at the shape rather than the average.
 */
export function tallyCycle(reviews: ReviewLike[]): CycleTally {
  const distribution: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratedTotal = 0;
  let rated = 0;

  for (const review of reviews) {
    if (review.finalRating !== null && isRating(review.finalRating)) {
      distribution[review.finalRating] += 1;
      ratedTotal += review.finalRating;
      rated += 1;
    }
  }

  return {
    total: reviews.length,
    awaitingSelf: reviews.filter((review) => review.status === "pending_self").length,
    awaitingManager: reviews.filter((review) => review.status === "pending_manager").length,
    completed: reviews.filter((review) => review.status === "completed").length,
    rated,
    averageFinal: rated === 0 ? null : Math.round((ratedTotal / rated) * 10) / 10,
    distribution,
  };
}
