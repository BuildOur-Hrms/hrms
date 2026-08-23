import { describe, expect, it } from "vitest";

import { bandFor, completionOf, headline, type CompletableTask } from "@/modules/tasks/completion";

/**
 * The number people are judged on. Every rule it encodes is arguable, so each
 * one is pinned here rather than left to be rediscovered from the arithmetic.
 */

const task = (over: Partial<CompletableTask> = {}): CompletableTask => ({
  origin: "assigned",
  status: "in_progress",
  weight: 1,
  progress: 0,
  ...over,
});

describe("weighting", () => {
  it("counts a heavy task for more than a light one", () => {
    const done = completionOf([
      task({ weight: 3, progress: 100, status: "completed" }),
      task({ weight: 1, progress: 0 }),
    ]);
    expect(done.assigned.percent).toBe(75);

    const backwards = completionOf([
      task({ weight: 3, progress: 0 }),
      task({ weight: 1, progress: 100, status: "completed" }),
    ]);
    expect(backwards.assigned.percent).toBe(25);
  });

  it("does not care what the weights add up to", () => {
    const small = completionOf([task({ weight: 1, progress: 100 }), task({ weight: 1 })]);
    const large = completionOf([task({ weight: 50, progress: 100 }), task({ weight: 50 })]);
    expect(small.assigned.percent).toBe(large.assigned.percent);
  });

  it("reports the weight it rested on, so a figure can be questioned", () => {
    expect(completionOf([task({ weight: 4 }), task({ weight: 6 })]).assigned.weight).toBe(10);
  });
});

describe("cancelled work", () => {
  it("leaves the calculation rather than counting as zero", () => {
    const withCancelled = completionOf([
      task({ progress: 100, status: "completed" }),
      task({ progress: 0, status: "cancelled" }),
    ]);
    expect(withCancelled.assigned.percent).toBe(100);
    expect(withCancelled.assigned.total).toBe(1);
  });

  it("leaves a month of nothing but cancellations at zero, not at NaN", () => {
    const all = completionOf([task({ status: "cancelled" }), task({ status: "cancelled" })]);
    expect(all.assigned.percent).toBe(0);
    expect(all.assigned.total).toBe(0);
  });
});

describe("assigned against self-added", () => {
  const mixed = [
    task({ origin: "assigned", weight: 1, progress: 40 }),
    task({ origin: "self", weight: 1, progress: 100, status: "completed" }),
  ];

  it("keeps them apart", () => {
    const result = completionOf(mixed);
    expect(result.assigned.percent).toBe(40);
    expect(result.self.percent).toBe(100);
  });

  it("cannot be raised by adding easy work to your own list", () => {
    const before = completionOf([task({ origin: "assigned", progress: 40 })]);
    const after = completionOf([
      task({ origin: "assigned", progress: 40 }),
      task({ origin: "self", progress: 100, status: "completed" }),
      task({ origin: "self", progress: 100, status: "completed" }),
    ]);
    expect(after.assigned.percent).toBe(before.assigned.percent);
  });

  it("still offers a combined figure for the person's own view", () => {
    expect(completionOf(mixed).overall.percent).toBe(70);
  });
});

describe("the headline", () => {
  it("is the assigned figure whenever anything was assigned", () => {
    const result = headline(
      completionOf([
        task({ origin: "assigned", progress: 20 }),
        task({ origin: "self", progress: 100 }),
      ]),
    );
    expect(result).toEqual({ percent: 20, basis: "assigned" });
  });

  it("falls back to self-added, so nobody sees a zero they did not earn", () => {
    const result = headline(completionOf([task({ origin: "self", progress: 60 })]));
    expect(result).toEqual({ percent: 60, basis: "self" });
  });

  it("says there is no basis at all for an empty month", () => {
    expect(headline(completionOf([]))).toEqual({ percent: 0, basis: null });
  });
});

describe("counting", () => {
  it("counts completed separately from progressed", () => {
    const result = completionOf([
      task({ progress: 100, status: "completed" }),
      task({ progress: 99 }),
    ]);
    expect(result.assigned.completed).toBe(1);
    expect(result.assigned.total).toBe(2);
    expect(result.assigned.percent).toBe(99.5);
  });

  it("rounds to one decimal rather than pretending to precision", () => {
    expect(completionOf([task({ progress: 100 }), task({}), task({})]).assigned.percent).toBe(33.3);
  });
});

describe("bands", () => {
  it("puts each percentage where the screens agree it goes", () => {
    expect(bandFor(100)).toBe("ahead");
    expect(bandFor(90)).toBe("ahead");
    expect(bandFor(89.9)).toBe("on-track");
    expect(bandFor(70)).toBe("on-track");
    expect(bandFor(69.9)).toBe("behind");
    expect(bandFor(40)).toBe("behind");
    expect(bandFor(39.9)).toBe("at-risk");
    expect(bandFor(0)).toBe("at-risk");
  });
});
