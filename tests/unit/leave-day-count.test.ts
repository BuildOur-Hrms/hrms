import { describe, expect, it } from "vitest";

import {
  countLeaveDays,
  datesBetween,
  splitAtYearBoundary,
  type DayCountInput,
} from "@/modules/leave/day-count";

/**
 * These numbers are deducted from balances, so the table is exhaustive on the
 * cases the roadmap names as mandatory: sandwich on and off, leave touching a
 * holiday or a week-off, half days, and the year-boundary split.
 *
 * Calendar anchors used throughout (all 2026):
 *   Mon 5 Jan, Fri 9 Jan, Sat 10 Jan, Sun 11 Jan, Mon 12 Jan, Fri 16 Jan.
 */

const WEEKEND = [0, 6];

function run(over: Partial<DayCountInput> & { startDate: string; endDate: string }) {
  return countLeaveDays({
    halfDay: "none",
    weekOffDays: WEEKEND,
    holidays: [],
    sandwichRule: false,
    ...over,
  });
}

describe("date enumeration", () => {
  it("is inclusive of both ends", () => {
    expect(datesBetween("2026-01-05", "2026-01-07")).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ]);
  });

  it("returns nothing when the span runs backwards", () => {
    expect(datesBetween("2026-01-07", "2026-01-05")).toEqual([]);
  });

  it("crosses a month boundary", () => {
    expect(datesBetween("2026-01-30", "2026-02-02")).toHaveLength(4);
  });
});

describe("a plain working span", () => {
  it("counts each working day", () => {
    expect(run({ startDate: "2026-01-05", endDate: "2026-01-07" }).days).toBe(3);
  });

  it("counts a single day", () => {
    expect(run({ startDate: "2026-01-05", endDate: "2026-01-05" }).days).toBe(1);
  });
});

describe("week-offs", () => {
  it("never charges a weekend inside the span when the rule is off", () => {
    // Fri 9th to Mon 12th: two working days, weekend free.
    expect(run({ startDate: "2026-01-09", endDate: "2026-01-12" }).days).toBe(2);
  });

  it("charges a weekend inside the span when the rule is on", () => {
    // The whole point of the rule: away Friday through Monday is four days.
    expect(run({ startDate: "2026-01-09", endDate: "2026-01-12", sandwichRule: true }).days).toBe(
      4,
    );
  });

  it("never charges a weekend adjacent to the span, rule on or off", () => {
    // Mon 5th to Fri 9th, with the weekend after it. Leaving on Friday does
    // not make you pay for a Saturday you were never going to work.
    for (const sandwichRule of [false, true]) {
      expect(run({ startDate: "2026-01-05", endDate: "2026-01-09", sandwichRule }).days).toBe(5);
    }
  });

  it("does not charge a leading weekend even with the rule on", () => {
    // Sat 10th to Wed 14th: the weekend leads, so it is adjacent, not inside.
    expect(run({ startDate: "2026-01-10", endDate: "2026-01-14", sandwichRule: true }).days).toBe(
      3,
    );
  });

  it("does not charge a trailing weekend even with the rule on", () => {
    // Wed 7th to Sun 11th.
    expect(run({ startDate: "2026-01-07", endDate: "2026-01-11", sandwichRule: true }).days).toBe(
      3,
    );
  });
});

describe("holidays", () => {
  it("is free when the rule is off", () => {
    const r = run({
      startDate: "2026-01-05",
      endDate: "2026-01-07",
      holidays: ["2026-01-06"],
    });
    expect(r.days).toBe(2);
  });

  it("is charged when it falls inside the span and the rule is on", () => {
    const r = run({
      startDate: "2026-01-05",
      endDate: "2026-01-07",
      holidays: ["2026-01-06"],
      sandwichRule: true,
    });
    expect(r.days).toBe(3);
  });

  it("is reported as a holiday even when it lands on a week-off", () => {
    // Otherwise it disappears into the weekend and nobody can explain the
    // day count back to the employee.
    const r = run({
      startDate: "2026-01-09",
      endDate: "2026-01-12",
      holidays: ["2026-01-10"],
    });
    expect(r.breakdown.find((d) => d.date === "2026-01-10")?.kind).toBe("holiday");
  });

  it("costs nothing when the whole span is holidays and week-offs", () => {
    const r = run({
      startDate: "2026-01-10",
      endDate: "2026-01-11",
      sandwichRule: true,
    });
    expect(r.days).toBe(0);
  });
});

describe("half days", () => {
  it("charges half for a single day", () => {
    expect(
      run({ startDate: "2026-01-05", endDate: "2026-01-05", halfDay: "first_half" }).days,
    ).toBe(0.5);
    expect(
      run({ startDate: "2026-01-05", endDate: "2026-01-05", halfDay: "second_half" }).days,
    ).toBe(0.5);
  });

  it("is ignored on a multi-day span rather than guessing which half", () => {
    expect(
      run({ startDate: "2026-01-05", endDate: "2026-01-07", halfDay: "first_half" }).days,
    ).toBe(3);
  });

  it("cannot make a free day cost half", () => {
    // A half day on a holiday is still no leave at all.
    const r = run({
      startDate: "2026-01-06",
      endDate: "2026-01-06",
      halfDay: "first_half",
      holidays: ["2026-01-06"],
    });
    expect(r.days).toBe(0);
  });
});

describe("the year boundary", () => {
  it("splits a span that crosses new year", () => {
    // Each year has its own accrual and its own carry-forward cap, so one
    // request is two charges.
    expect(splitAtYearBoundary("2026-12-28", "2027-01-03")).toEqual([
      { year: 2026, startDate: "2026-12-28", endDate: "2026-12-31" },
      { year: 2027, startDate: "2027-01-01", endDate: "2027-01-03" },
    ]);
  });

  it("leaves a span inside one year alone", () => {
    expect(splitAtYearBoundary("2026-03-01", "2026-03-05")).toEqual([
      { year: 2026, startDate: "2026-03-01", endDate: "2026-03-05" },
    ]);
  });
});

describe("the breakdown", () => {
  it("explains every date, so a day count can be justified to the employee", () => {
    const r = run({
      startDate: "2026-01-09",
      endDate: "2026-01-12",
      sandwichRule: true,
    });
    expect(r.breakdown.map((d) => `${d.date} ${d.kind} ${d.charged}`)).toEqual([
      "2026-01-09 working 1",
      "2026-01-10 week_off 1",
      "2026-01-11 week_off 1",
      "2026-01-12 working 1",
    ]);
  });
});
