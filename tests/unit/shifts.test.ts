import { describe, expect, it } from "vitest";

import {
  createShiftSchema,
  dateToTime,
  shiftDurationMinutes,
  timeOfDaySchema,
  timeToDate,
  weekOffDaysSchema,
} from "@/modules/shifts/validators";

/**
 * Shift rules feed attendance calculation, which feeds payroll, so the cases
 * here are the ones that would otherwise be discovered as a wrong number on
 * someone's payslip: the overnight wrap, the day that is both start and end,
 * and week-off arrays that look valid but mean nothing.
 */

describe("time of day", () => {
  it("accepts a 24-hour clock and rejects anything else", () => {
    for (const good of ["00:00", "09:30", "18:00", "23:59"]) {
      expect(timeOfDaySchema.safeParse(good).success).toBe(true);
    }
    for (const bad of ["24:00", "9:30", "18:60", "6pm", "18:00:00", ""]) {
      expect(timeOfDaySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("round-trips through the Date the driver wants", () => {
    for (const value of ["00:00", "09:05", "13:45", "23:59"]) {
      expect(dateToTime(timeToDate(value))).toBe(value);
    }
  });

  it("keeps the wall clock rather than shifting into local time", () => {
    // The bug this guards: building the Date with `new Date(1970, 0, 1, h, m)`
    // uses local time, so 09:00 stored from IST reads back as 03:30 UTC.
    const nine = timeToDate("09:00");
    expect(nine.getUTCHours()).toBe(9);
    expect(nine.getUTCMinutes()).toBe(0);
  });
});

describe("shift duration", () => {
  it("measures an ordinary day", () => {
    expect(shiftDurationMinutes("09:00", "18:00")).toBe(540);
  });

  it("deducts the unpaid break", () => {
    expect(shiftDurationMinutes("09:00", "18:00", 60)).toBe(480);
  });

  it("wraps midnight instead of going negative", () => {
    // A plain end-minus-start gives -960 here, which would mark every night
    // worker absent.
    expect(shiftDurationMinutes("22:00", "06:00")).toBe(480);
    expect(shiftDurationMinutes("22:00", "06:00", 30)).toBe(450);
  });

  it("treats one minute past midnight as a full day, not a minute", () => {
    expect(shiftDurationMinutes("00:01", "00:00")).toBe(1439);
  });
});

describe("week-off days", () => {
  it("deduplicates and sorts, so {6,0,6} is two days not three", () => {
    expect(weekOffDaysSchema.parse([6, 0, 6])).toEqual([0, 6]);
  });

  it("rejects a weekday outside 0..6", () => {
    expect(weekOffDaysSchema.safeParse([7]).success).toBe(false);
    expect(weekOffDaysSchema.safeParse([-1]).success).toBe(false);
  });

  it("refuses a shift with every day off", () => {
    expect(weekOffDaysSchema.safeParse([0, 1, 2, 3, 4, 5, 6]).success).toBe(false);
  });

  it("allows no days off at all", () => {
    expect(weekOffDaysSchema.parse([])).toEqual([]);
  });
});

describe("create shift", () => {
  const valid = {
    name: "General",
    code: "gen",
    startTime: "09:00",
    endTime: "18:00",
    halfDayThresholdMinutes: 240,
  };

  it("applies the documented defaults", () => {
    const parsed = createShiftSchema.parse(valid);
    expect(parsed.graceMinutes).toBe(10);
    expect(parsed.breakMinutes).toBe(0);
    expect(parsed.weekOffDays).toEqual([0, 6]);
    expect(parsed.isDefault).toBe(false);
  });

  it("upper-cases the code, since codes reach reports and URLs", () => {
    expect(createShiftSchema.parse(valid).code).toBe("GEN");
  });

  it("accepts an overnight shift", () => {
    const parsed = createShiftSchema.parse({ ...valid, startTime: "22:00", endTime: "06:00" });
    expect(parsed.startTime).toBe("22:00");
  });

  it("requires a half-day threshold, which has no sensible default", () => {
    const withoutThreshold = { ...valid } as Partial<typeof valid>;
    delete withoutThreshold.halfDayThresholdMinutes;
    expect(createShiftSchema.safeParse(withoutThreshold).success).toBe(false);
  });

  it("bounds the minutes fields to match the database CHECKs", () => {
    // Validation looser than the constraint turns a 422 into a 500.
    expect(createShiftSchema.safeParse({ ...valid, graceMinutes: 241 }).success).toBe(false);
    expect(createShiftSchema.safeParse({ ...valid, breakMinutes: 481 }).success).toBe(false);
    expect(createShiftSchema.safeParse({ ...valid, halfDayThresholdMinutes: 1441 }).success).toBe(
      false,
    );
    expect(createShiftSchema.safeParse({ ...valid, halfDayThresholdMinutes: 0 }).success).toBe(
      false,
    );
  });

  it("rejects a code with characters that do not survive a URL", () => {
    expect(createShiftSchema.safeParse({ ...valid, code: "gen shift" }).success).toBe(false);
    expect(createShiftSchema.safeParse({ ...valid, code: "g" }).success).toBe(false);
  });
});
