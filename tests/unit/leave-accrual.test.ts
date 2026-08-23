import { describe, expect, it } from "vitest";

import {
  accrualFor,
  carryForwardAmount,
  currentBalance,
  hasSufficientBalance,
  monthEarnsAccrual,
  round2,
} from "@/modules/leave/accrual";

/**
 * Mid-month joiner proration and negative-balance prevention are both on the
 * roadmap's mandatory list, and both are the kind of thing nobody notices is
 * wrong until a leaving employee is paid out the wrong number of days.
 */

describe("month eligibility", () => {
  const join = "2026-04-10";

  it("earns nothing before the join month", () => {
    expect(monthEarnsAccrual(2026, 3, join, null, 15)).toBe(false);
  });

  it("earns the join month when they started on or before the cutoff", () => {
    expect(monthEarnsAccrual(2026, 4, join, null, 15)).toBe(true);
    expect(monthEarnsAccrual(2026, 4, "2026-04-15", null, 15)).toBe(true);
  });

  it("does not earn the join month when they started after it", () => {
    expect(monthEarnsAccrual(2026, 4, "2026-04-16", null, 15)).toBe(false);
    expect(monthEarnsAccrual(2026, 4, "2026-04-28", null, 15)).toBe(false);
  });

  it("earns every month after joining", () => {
    expect(monthEarnsAccrual(2026, 12, join, null, 15)).toBe(true);
    expect(monthEarnsAccrual(2027, 1, join, null, 15)).toBe(true);
  });

  it("earns the exit month, then stops", () => {
    // They were present for part of it; charging them nothing for a month
    // they worked would be the wrong way to round.
    expect(monthEarnsAccrual(2026, 9, join, "2026-09-04", 15)).toBe(true);
    expect(monthEarnsAccrual(2026, 10, join, "2026-09-04", 15)).toBe(false);
  });

  it("honours a cutoff other than the fifteenth", () => {
    expect(monthEarnsAccrual(2026, 4, "2026-04-10", null, 5)).toBe(false);
    expect(monthEarnsAccrual(2026, 4, "2026-04-03", null, 5)).toBe(true);
  });
});

describe("monthly accrual", () => {
  const base = {
    frequency: "monthly" as const,
    amount: 1.5,
    year: 2026,
    joinDate: "2026-01-01",
    joinCutoffDay: 15,
  };

  it("credits the flat amount for an earned month", () => {
    expect(accrualFor({ ...base, month: 6 })).toBe(1.5);
  });

  it("credits nothing for a month before joining", () => {
    expect(accrualFor({ ...base, month: 2, joinDate: "2026-05-02" })).toBe(0);
  });

  it("credits nothing without a month", () => {
    expect(accrualFor({ ...base })).toBe(0);
  });
});

describe("yearly accrual", () => {
  const base = {
    frequency: "yearly" as const,
    amount: 12,
    year: 2026,
    joinCutoffDay: 15,
  };

  it("credits the full amount for a full year", () => {
    expect(accrualFor({ ...base, joinDate: "2025-06-01" })).toBe(12);
  });

  it("prorates a mid-year joiner by earned months", () => {
    // Joined 10 April: April through December is nine months of twelve.
    expect(accrualFor({ ...base, joinDate: "2026-04-10" })).toBe(9);
  });

  it("drops the join month when they started after the cutoff", () => {
    // Joined 16 April: May through December, eight months.
    expect(accrualFor({ ...base, joinDate: "2026-04-16" })).toBe(8);
  });

  it("prorates a leaver too", () => {
    expect(accrualFor({ ...base, joinDate: "2025-01-01", exitDate: "2026-03-20" })).toBe(3);
  });

  it("rounds to the two decimals the column holds", () => {
    // 10 days over seven earned months is 5.8333…
    expect(accrualFor({ ...base, amount: 10, joinDate: "2026-06-01" })).toBe(5.83);
  });
});

describe("no accrual", () => {
  it("credits nothing regardless of amount", () => {
    expect(
      accrualFor({
        frequency: "none",
        amount: 20,
        year: 2026,
        month: 5,
        joinDate: "2020-01-01",
        joinCutoffDay: 15,
      }),
    ).toBe(0);
  });
});

describe("the current balance", () => {
  it("is the components, not a stored total", () => {
    expect(
      currentBalance({ opening: 2, accrued: 6, used: 3, carriedForward: 1.5, adjusted: 0.5 }),
    ).toBe(7);
  });

  it("can go negative when more was used than earned", () => {
    expect(
      currentBalance({ opening: 0, accrued: 1, used: 3, carriedForward: 0, adjusted: 0 }),
    ).toBe(-2);
  });

  it("handles a manual debit", () => {
    expect(
      currentBalance({ opening: 5, accrued: 0, used: 0, carriedForward: 0, adjusted: -2 }),
    ).toBe(3);
  });
});

describe("carry forward", () => {
  it("caps at the policy limit", () => {
    expect(carryForwardAmount(12, 5)).toBe(5);
  });

  it("carries the whole balance when it is under the cap", () => {
    expect(carryForwardAmount(3, 5)).toBe(3);
  });

  it("never carries a debt into next year", () => {
    expect(carryForwardAmount(-4, 5)).toBe(0);
  });

  it("carries nothing when the policy allows nothing", () => {
    expect(carryForwardAmount(9, 0)).toBe(0);
  });
});

describe("sufficiency", () => {
  it("allows a request the balance covers", () => {
    expect(hasSufficientBalance(5, 3, 0)).toBe(true);
  });

  it("allows one that lands exactly on zero", () => {
    expect(hasSufficientBalance(3, 3, 0)).toBe(true);
  });

  it("refuses going negative when the policy forbids it", () => {
    expect(hasSufficientBalance(2, 3, 0)).toBe(false);
  });

  it("allows going negative within the policy's limit", () => {
    expect(hasSufficientBalance(2, 4, 2)).toBe(true);
    expect(hasSufficientBalance(2, 5, 2)).toBe(false);
  });

  it("treats the limit as a magnitude, however it was stored", () => {
    expect(hasSufficientBalance(0, 2, -2)).toBe(true);
  });

  it("survives floating point, which is why round2 exists", () => {
    // 0.1 + 0.2 arithmetic would otherwise refuse a request that fits.
    expect(hasSufficientBalance(0.3, 0.1 + 0.2, 0)).toBe(true);
  });
});

describe("rounding", () => {
  it("keeps two decimals", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(5.8333)).toBe(5.83);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
