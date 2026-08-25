import { describe, expect, it } from "vitest";

import {
  canMoveCycle,
  canMoveReview,
  goalProgress,
  goalsAreOpen,
  isRating,
  reviewsAreOpen,
  tallyCycle,
  type CycleStatus,
  type ReviewStatus,
} from "@/modules/performance/rules";

/**
 * The performance rules, argued about with no database in the room.
 */

describe("the rating scale", () => {
  it("accepts one through five", () => {
    for (const value of [1, 2, 3, 4, 5]) expect(isRating(value)).toBe(true);
  });

  it("refuses zero, six, and anything between the rungs", () => {
    for (const value of [0, 6, -1, 3.5]) expect(isRating(value)).toBe(false);
  });
});

describe("moving a cycle along", () => {
  it("follows the order", () => {
    expect(canMoveCycle("draft", "active")).toBe(true);
    expect(canMoveCycle("active", "review")).toBe(true);
    expect(canMoveCycle("review", "closed")).toBe(true);
  });

  it("lets reviews be closed early from active", () => {
    // A cycle abandoned halfway is closed, not left open forever.
    expect(canMoveCycle("active", "closed")).toBe(true);
  });

  it("allows going back from review to active", () => {
    // Opening reviews before everybody has agreed their goals is a common
    // mistake, and the alternative to reversing it is starting again.
    expect(canMoveCycle("review", "active")).toBe(true);
  });

  it("refuses to skip straight to review", () => {
    expect(canMoveCycle("draft", "review")).toBe(false);
  });

  it.each<CycleStatus>(["closed"])("treats %s as final", (status) => {
    expect(canMoveCycle(status, "active")).toBe(false);
    expect(canMoveCycle(status, "review")).toBe(false);
    expect(canMoveCycle(status, "closed")).toBe(false);
  });
});

describe("what a cycle's stage allows", () => {
  it("takes goals while drafting and while running", () => {
    expect(goalsAreOpen("draft")).toBe(true);
    expect(goalsAreOpen("active")).toBe(true);
  });

  it("stops taking goals once reviews open", () => {
    // Adding a goal after somebody has been rated against the set changes
    // what they were rated on.
    expect(goalsAreOpen("review")).toBe(false);
    expect(goalsAreOpen("closed")).toBe(false);
  });

  it("takes reviews only in the review stage", () => {
    expect(reviewsAreOpen("review")).toBe(true);
    for (const status of ["draft", "active", "closed"] as CycleStatus[]) {
      expect(reviewsAreOpen(status)).toBe(false);
    }
  });
});

describe("moving a review along", () => {
  it("goes from the person, to their manager, to done", () => {
    expect(canMoveReview("pending_self", "pending_manager")).toBe(true);
    expect(canMoveReview("pending_manager", "completed")).toBe(true);
  });

  it("can be sent back to the person who wrote it", () => {
    // A manager who rated the wrong person needs a way out that is not a
    // database edit.
    expect(canMoveReview("pending_manager", "pending_self")).toBe(true);
    expect(canMoveReview("completed", "pending_manager")).toBe(true);
  });

  it("refuses to skip the self stage", () => {
    expect(canMoveReview("pending_self", "completed")).toBe(false);
  });

  it("refuses to reopen a finished review all the way back", () => {
    expect(canMoveReview("completed", "pending_self")).toBe(false);
  });

  it.each<ReviewStatus>(["pending_self", "pending_manager", "completed"])(
    "never moves %s to itself",
    (status) => {
      expect(canMoveReview(status, status)).toBe(false);
    },
  );
});

describe("progress through a goal set", () => {
  it("weights the big goals more heavily", () => {
    const progress = goalProgress([
      { weight: 3, progress: 100, status: "completed" },
      { weight: 1, progress: 0, status: "not_started" },
    ]);
    expect(progress).toBe(75);
  });

  it("leaves a cancelled goal out rather than counting it as zero", () => {
    // A goal that was called off is not a goal that was missed.
    const progress = goalProgress([
      { weight: 1, progress: 100, status: "completed" },
      { weight: 1, progress: 0, status: "cancelled" },
    ]);
    expect(progress).toBe(100);
  });

  it("answers zero for an empty set rather than dividing by nothing", () => {
    expect(goalProgress([])).toBe(0);
    expect(goalProgress([{ weight: 1, progress: 50, status: "cancelled" }])).toBe(0);
  });

  it("is not thrown by a weight of zero", () => {
    expect(goalProgress([{ weight: 0, progress: 100, status: "completed" }])).toBe(0);
  });
});

describe("how a cycle is going", () => {
  const reviews = [
    { status: "completed" as const, finalRating: 4 },
    { status: "completed" as const, finalRating: 4 },
    { status: "completed" as const, finalRating: 3 },
    { status: "pending_manager" as const, finalRating: null },
    { status: "pending_self" as const, finalRating: null },
  ];

  it("counts who is waiting on whom", () => {
    expect(tallyCycle(reviews)).toMatchObject({
      total: 5,
      awaitingSelf: 1,
      awaitingManager: 1,
      completed: 3,
    });
  });

  it("averages only the ratings that exist", () => {
    // Three ratings of 4, 4 and 3 — the two unrated reviews are not zeroes.
    expect(tallyCycle(reviews).averageFinal).toBe(3.7);
  });

  it("reports no average at all when nothing has been rated", () => {
    expect(tallyCycle([{ status: "pending_self", finalRating: null }]).averageFinal).toBeNull();
  });

  it("shows the shape, which is what calibration is judged on", () => {
    expect(tallyCycle(reviews).distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 2, 5: 0 });
  });

  it("ignores a rating outside the scale rather than plotting it nowhere", () => {
    const tally = tallyCycle([{ status: "completed", finalRating: 9 }]);
    expect(tally.rated).toBe(0);
    expect(tally.averageFinal).toBeNull();
  });
});
