import { describe, expect, it } from "vitest";

import {
  computePayslip,
  daysInMonth,
  lopDaysFor,
  prorate,
  roundMinor,
  type AttendanceDay,
  type Component,
} from "@/modules/payroll/calculator";

/**
 * The payroll arithmetic, argued about against examples.
 *
 * Amounts are in minor units throughout: 50000_00 is fifty thousand rupees.
 */

const BASIC: Component = {
  code: "BASIC",
  name: "Basic",
  kind: "earning",
  prorates: true,
  sortOrder: 1,
  amountMinor: 50000_00,
};

const HRA: Component = {
  code: "HRA",
  name: "House rent allowance",
  kind: "earning",
  prorates: true,
  sortOrder: 2,
  percentOf: { code: "BASIC", percent: 50 },
};

const PF: Component = {
  code: "PF",
  name: "Provident fund",
  kind: "deduction",
  prorates: true,
  sortOrder: 10,
  percentOf: { code: "BASIC", percent: 12 },
};

describe("rounding money", () => {
  it("rounds a half unit away from zero, in both directions", () => {
    // Math.round would give -2 here, treating the same half-unit one way for
    // an earning and another for a deduction.
    expect(roundMinor(2.5)).toBe(3);
    expect(roundMinor(-2.5)).toBe(-3);
  });

  it("leaves whole units alone", () => {
    expect(roundMinor(1234)).toBe(1234);
    expect(roundMinor(-1234)).toBe(-1234);
  });
});

describe("prorating", () => {
  it("pays the whole amount for a whole month", () => {
    expect(prorate(30000_00, 30, 30)).toBe(30000_00);
  });

  it("takes a day off a thirty-day month", () => {
    expect(prorate(30000_00, 29, 30)).toBe(29000_00);
  });

  it("pays nothing for no payable days", () => {
    expect(prorate(30000_00, 0, 30)).toBe(0);
  });

  it("rounds to the minor unit rather than carrying a fraction", () => {
    // 50000.00 over 31 days, 30 payable: 48387.0967...
    expect(prorate(50000_00, 30, 31)).toBe(4838710);
  });

  it("does not pay extra for more days than the month had", () => {
    expect(prorate(30000_00, 45, 30)).toBe(30000_00);
  });

  it("survives a period of no days rather than dividing by zero", () => {
    expect(prorate(30000_00, 0, 0)).toBe(0);
  });
});

describe("loss of pay", () => {
  const month = (days: AttendanceDay[]) => lopDaysFor(days);

  it("costs a day for an absence nothing covers", () => {
    expect(month([{ status: "absent" }, { status: "present" }])).toBe(1);
  });

  it("costs half a day for a half day", () => {
    expect(month([{ status: "half_day" }])).toBe(0.5);
  });

  it("costs nothing for paid leave", () => {
    expect(month([{ status: "on_leave" }])).toBe(0);
  });

  it("costs a day for unpaid leave", () => {
    expect(month([{ status: "on_leave", unpaidLeave: true }])).toBe(1);
  });

  it("costs nothing for holidays and week-offs", () => {
    // Somebody absent all month is still paid for the Sundays in it. That is
    // what a monthly salary means.
    expect(month([{ status: "holiday" }, { status: "week_off" }])).toBe(0);
  });

  it("adds halves without floating-point dust", () => {
    const days: AttendanceDay[] = Array.from({ length: 3 }, () => ({ status: "half_day" }));
    expect(month(days)).toBe(1.5);
  });
});

describe("a full month's pay", () => {
  const payslip = computePayslip({
    components: [BASIC, HRA, PF],
    periodDays: 30,
    lopDays: 0,
  });

  it("pays the fixed component in full", () => {
    expect(payslip.lines.find((line) => line.code === "BASIC")?.amountMinor).toBe(50000_00);
  });

  it("works a percentage off the component it names", () => {
    expect(payslip.lines.find((line) => line.code === "HRA")?.amountMinor).toBe(25000_00);
  });

  it("totals the earnings and the deductions separately", () => {
    expect(payslip.grossMinor).toBe(75000_00);
    expect(payslip.deductionsMinor).toBe(6000_00);
    expect(payslip.netMinor).toBe(69000_00);
  });

  it("adds up on the page", () => {
    // The totals are the sum of the printed lines, not a separate reckoning.
    const earnings = payslip.lines
      .filter((line) => line.kind === "earning")
      .reduce((sum, line) => sum + line.amountMinor, 0);
    expect(earnings).toBe(payslip.grossMinor);
  });

  it("keeps the lines in the order they are meant to be read", () => {
    expect(payslip.lines.map((line) => line.code)).toEqual(["BASIC", "HRA", "PF"]);
  });
});

describe("a month with loss of pay", () => {
  const payslip = computePayslip({
    components: [BASIC, HRA, PF],
    periodDays: 30,
    lopDays: 3,
  });

  it("counts the payable days", () => {
    expect(payslip.payableDays).toBe(27);
  });

  it("cuts the fixed component by the days lost", () => {
    expect(payslip.lines.find((line) => line.code === "BASIC")?.amountMinor).toBe(45000_00);
  });

  it("works the percentage off what was actually earned", () => {
    // Provident fund at 12% of a basic already cut by three days. Anything
    // else deducts against money nobody received.
    expect(payslip.lines.find((line) => line.code === "PF")?.amountMinor).toBe(5400_00);
  });
});

describe("a component that does not prorate", () => {
  it("is paid in full however many days were lost", () => {
    const reimbursement: Component = {
      code: "PHONE",
      name: "Phone bill",
      kind: "earning",
      prorates: false,
      sortOrder: 3,
      amountMinor: 1000_00,
    };

    const payslip = computePayslip({
      components: [BASIC, reimbursement],
      periodDays: 30,
      lopDays: 15,
    });

    expect(payslip.lines.find((line) => line.code === "PHONE")?.amountMinor).toBe(1000_00);
    expect(payslip.lines.find((line) => line.code === "BASIC")?.amountMinor).toBe(25000_00);
  });
});

describe("the awkward cases", () => {
  it("treats a percentage of a component nobody has as zero", () => {
    // Somebody with no basic pay has no provident fund to deduct. That is not
    // an error, it is an answer.
    const payslip = computePayslip({ components: [PF], periodDays: 30, lopDays: 0 });
    expect(payslip.lines.find((line) => line.code === "PF")?.amountMinor).toBe(0);
  });

  it("lets the net go negative rather than hiding money still owed", () => {
    const recovery: Component = {
      code: "ADVANCE",
      name: "Salary advance recovery",
      kind: "deduction",
      prorates: false,
      sortOrder: 20,
      amountMinor: 60000_00,
    };

    const payslip = computePayslip({
      components: [BASIC, recovery],
      periodDays: 30,
      lopDays: 0,
    });

    expect(payslip.netMinor).toBe(-10000_00);
  });

  it("pays nothing at all for a month entirely lost", () => {
    const payslip = computePayslip({
      components: [BASIC, HRA, PF],
      periodDays: 30,
      lopDays: 30,
    });

    expect(payslip.payableDays).toBe(0);
    expect(payslip.grossMinor).toBe(0);
    expect(payslip.netMinor).toBe(0);
  });

  it("refuses to lose more days than the month had", () => {
    const payslip = computePayslip({ components: [BASIC], periodDays: 30, lopDays: 45 });
    expect(payslip.payableDays).toBe(0);
    expect(payslip.lopDays).toBe(30);
  });

  it("produces an empty payslip rather than falling over with no components", () => {
    const payslip = computePayslip({ components: [], periodDays: 31, lopDays: 0 });
    expect(payslip).toMatchObject({ lines: [], grossMinor: 0, netMinor: 0 });
  });
});

describe("the length of a month", () => {
  it("knows the short ones", () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2027, 4)).toBe(30);
  });

  it("knows a leap February", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
  });

  it("knows December", () => {
    expect(daysInMonth(2027, 12)).toBe(31);
  });
});
