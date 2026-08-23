import { describe, expect, it } from "vitest";

import {
  calcAttendance,
  pairPunches,
  resolveWorkDate,
  shiftSpanMinutes,
  type CalcInput,
  type ShiftRules,
} from "@/modules/attendance/calc";

/**
 * The calculator decides what people are paid, so this table is deliberately
 * exhaustive: late, half-day, overtime, overnight, week-off, missing checkout,
 * and the timezone case that makes all of them wrong if it is handled badly.
 *
 * docs/10-roadmap-testing-deployment.md lists precisely this as M2's "done
 * when".
 */

const TZ = "Asia/Kolkata";

const DAY: ShiftRules = {
  startTime: "09:00",
  endTime: "18:00",
  graceMinutes: 10,
  halfDayThresholdMinutes: 240,
  breakMinutes: 60,
  weekOffDays: [0, 6],
};

const NIGHT: ShiftRules = { ...DAY, startTime: "22:00", endTime: "06:00" };

/** `09:30` on the given date in Asia/Kolkata, as the instant it really is. */
function at(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  // Kolkata is UTC+05:30 year-round, so the conversion is a fixed offset.
  const utcMinutes = h! * 60 + m! - (5 * 60 + 30);
  const base = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(base + utcMinutes * 60_000);
}

function run(over: Partial<CalcInput> & { punches: CalcInput["punches"] }) {
  return calcAttendance({
    // 2026-01-15 is a Thursday — a working day under the default week-off.
    workDate: "2026-01-15",
    timeZone: TZ,
    shift: DAY,
    ...over,
  });
}

const inOut = (date: string, i: string, o: string) => [
  { punchedAt: at(date, i), direction: "in" as const },
  { punchedAt: at(date, o), direction: "out" as const },
];

describe("shift span", () => {
  it("measures a normal shift", () => {
    expect(shiftSpanMinutes("09:00", "18:00")).toBe(540);
  });

  it("wraps midnight rather than going negative", () => {
    expect(shiftSpanMinutes("22:00", "06:00")).toBe(480);
  });
});

describe("pairing punches", () => {
  it("pairs a simple in/out", () => {
    const { segments, openIn, strayOut } = pairPunches(inOut("2026-01-15", "09:00", "18:00"));
    expect(segments).toHaveLength(1);
    expect(openIn).toBeNull();
    expect(strayOut).toBe(false);
  });

  it("keeps the earliest of a duplicated check-in", () => {
    // The first tap did not register, so the person tapped again.
    const { segments } = pairPunches([
      { punchedAt: at("2026-01-15", "09:00"), direction: "in" },
      { punchedAt: at("2026-01-15", "09:02"), direction: "in" },
      { punchedAt: at("2026-01-15", "18:00"), direction: "out" },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.in).toEqual(at("2026-01-15", "09:00"));
  });

  it("reports an unclosed check-in rather than guessing an end", () => {
    const { segments, openIn } = pairPunches([
      { punchedAt: at("2026-01-15", "09:00"), direction: "in" },
    ]);
    expect(segments).toHaveLength(0);
    expect(openIn).toEqual(at("2026-01-15", "09:00"));
  });

  it("reports a check-out with nothing open", () => {
    const { strayOut } = pairPunches([{ punchedAt: at("2026-01-15", "18:00"), direction: "out" }]);
    expect(strayOut).toBe(true);
  });

  it("sorts punches that arrive out of order", () => {
    const { segments } = pairPunches([
      { punchedAt: at("2026-01-15", "18:00"), direction: "out" },
      { punchedAt: at("2026-01-15", "09:00"), direction: "in" },
    ]);
    expect(segments).toHaveLength(1);
  });
});

describe("a normal working day", () => {
  it("is present, on time, with the unpaid break deducted", () => {
    const r = run({ punches: inOut("2026-01-15", "09:00", "18:00") });
    expect(r.status).toBe("present");
    // 540 clocked, less the 60-minute break nobody punched out for.
    expect(r.workedMinutes).toBe(480);
    expect(r.lateMinutes).toBe(0);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.needsReview).toBe(false);
  });

  it("does not charge the break twice when it was punched", () => {
    // Out for exactly the scheduled hour, so nothing further is deducted.
    const r = run({
      punches: [...inOut("2026-01-15", "09:00", "13:00"), ...inOut("2026-01-15", "14:00", "18:00")],
    });
    expect(r.workedMinutes).toBe(480);
    expect(r.overtimeMinutes).toBe(0);
  });

  it("deducts only the unpunched remainder of a short break", () => {
    // 20 minutes punched out of a 60-minute break, so 40 remain unpaid.
    const r = run({
      punches: [...inOut("2026-01-15", "09:00", "13:00"), ...inOut("2026-01-15", "13:20", "18:00")],
    });
    expect(r.workedMinutes).toBe(520 - 40);
  });

  it("records first in and last out across several segments", () => {
    const r = run({
      punches: [...inOut("2026-01-15", "09:00", "13:00"), ...inOut("2026-01-15", "14:00", "18:00")],
    });
    expect(r.firstIn).toEqual(at("2026-01-15", "09:00"));
    expect(r.lastOut).toEqual(at("2026-01-15", "18:00"));
  });
});

describe("lateness", () => {
  it("forgives arrival inside the grace window", () => {
    expect(run({ punches: inOut("2026-01-15", "09:10", "18:00") }).lateMinutes).toBe(0);
  });

  it("counts from the shift start, not from the end of grace", () => {
    // 09:25 is 25 minutes after 09:00, of which 10 were forgiven.
    expect(run({ punches: inOut("2026-01-15", "09:25", "18:00") }).lateMinutes).toBe(15);
  });

  it("never goes negative for an early arrival", () => {
    expect(run({ punches: inOut("2026-01-15", "08:30", "18:00") }).lateMinutes).toBe(0);
  });
});

describe("half day and absence", () => {
  it("is a half day below the threshold", () => {
    // 09:00-12:00 is 180 clocked, 120 after the break, under the 240 threshold.
    const r = run({ punches: inOut("2026-01-15", "09:00", "12:00") });
    expect(r.status).toBe("half_day");
    expect(r.workedMinutes).toBe(120);
  });

  it("is present exactly at the threshold, not half a day", () => {
    // 240 worked after the break: the threshold is "under", not "at or under".
    const r = run({ punches: inOut("2026-01-15", "09:00", "14:00") });
    expect(r.workedMinutes).toBe(240);
    expect(r.status).toBe("present");
  });

  it("is absent with no punches at all", () => {
    const r = run({ punches: [] });
    expect(r.status).toBe("absent");
    expect(r.workedMinutes).toBe(0);
    expect(r.firstIn).toBeNull();
    expect(r.needsReview).toBe(false);
  });
});

describe("overtime", () => {
  it("counts time beyond the scheduled day", () => {
    // 09:00-20:00 is 660 clocked, 600 worked, against 480 scheduled.
    expect(run({ punches: inOut("2026-01-15", "09:00", "20:00") }).overtimeMinutes).toBe(120);
  });

  it("is zero for a short day rather than negative", () => {
    expect(run({ punches: inOut("2026-01-15", "09:00", "12:00") }).overtimeMinutes).toBe(0);
  });
});

describe("non-working days", () => {
  it("is a week off on Sunday, with no lateness", () => {
    // 2026-01-18 is a Sunday.
    const r = run({ workDate: "2026-01-18", punches: [] });
    expect(r.status).toBe("week_off");
    expect(r.lateMinutes).toBe(0);
  });

  it("counts a whole week-off shift as overtime", () => {
    const r = run({ workDate: "2026-01-18", punches: inOut("2026-01-18", "10:00", "14:00") });
    expect(r.status).toBe("week_off");
    expect(r.workedMinutes).toBe(180);
    expect(r.overtimeMinutes).toBe(180);
    expect(r.lateMinutes).toBe(0);
  });

  it("is a holiday when the caller says so", () => {
    expect(run({ punches: [], isHoliday: true }).status).toBe("holiday");
  });

  it("puts leave ahead of a holiday, so a booked day is not handed back", () => {
    expect(run({ punches: [], isHoliday: true, isOnLeave: true }).status).toBe("on_leave");
  });

  it("puts leave ahead of a week off", () => {
    expect(run({ workDate: "2026-01-18", punches: [], isOnLeave: true }).status).toBe("on_leave");
  });
});

describe("overnight shifts", () => {
  it("measures a shift that crosses midnight", () => {
    const r = run({
      shift: NIGHT,
      punches: [
        { punchedAt: at("2026-01-15", "22:00"), direction: "in" },
        { punchedAt: at("2026-01-16", "06:00"), direction: "out" },
      ],
    });
    expect(r.status).toBe("present");
    // 480 clocked, less the 60-minute break: 420, against 420 scheduled.
    expect(r.workedMinutes).toBe(420);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.lateMinutes).toBe(0);
  });

  it("counts lateness against the previous evening, not the new day", () => {
    // The naive bug: reading 00:30 as 30 minutes past midnight makes someone
    // who arrived 2.5 hours late look like they arrived 21.5 hours early.
    const r = run({
      shift: NIGHT,
      punches: [
        { punchedAt: at("2026-01-16", "00:30"), direction: "in" },
        { punchedAt: at("2026-01-16", "06:00"), direction: "out" },
      ],
    });
    expect(r.lateMinutes).toBe(150 - 10);
  });
});

describe("broken punch streams", () => {
  it("flags a missing check-out and does not invent one", () => {
    const r = run({ punches: [{ punchedAt: at("2026-01-15", "09:00"), direction: "in" }] });
    expect(r.needsReview).toBe(true);
    expect(r.workedMinutes).toBe(0);
    expect(r.lastOut).toBeNull();
    // Still reported, so the day shows when the person actually arrived.
    expect(r.firstIn).toEqual(at("2026-01-15", "09:00"));
    expect(r.status).toBe("absent");
  });

  it("flags a check-out with no check-in", () => {
    const r = run({ punches: [{ punchedAt: at("2026-01-15", "18:00"), direction: "out" }] });
    expect(r.needsReview).toBe(true);
    expect(r.workedMinutes).toBe(0);
  });

  it("keeps a completed pair when a later check-in is left open", () => {
    const r = run({
      punches: [
        ...inOut("2026-01-15", "09:00", "13:00"),
        { punchedAt: at("2026-01-15", "14:00"), direction: "in" },
      ],
    });
    expect(r.needsReview).toBe(true);
    // The closed segment still counts; the open one does not.
    expect(r.workedMinutes).toBe(240 - 60);
  });
});

describe("timezone handling", () => {
  it("reads the wall clock in the employee's zone, not the server's", () => {
    // 03:30 UTC is 09:00 in Kolkata: on time. Read as UTC it would be 09:00
    // *late*, since 03:30 is five and a half hours before the shift starts.
    const r = calcAttendance({
      workDate: "2026-01-15",
      timeZone: TZ,
      shift: DAY,
      punches: [
        { punchedAt: new Date("2026-01-15T03:30:00.000Z"), direction: "in" },
        { punchedAt: new Date("2026-01-15T12:30:00.000Z"), direction: "out" },
      ],
    });
    expect(r.lateMinutes).toBe(0);
    expect(r.status).toBe("present");
  });

  it("gives a different answer in a different zone, from the same instants", () => {
    // The same two instants in UTC are an 03:30 start — six and a half hours
    // early for a 09:00 shift, so still not late, but the day is a different
    // shape. What matters is that the zone is honoured rather than assumed.
    const punches = [
      { punchedAt: new Date("2026-01-15T03:30:00.000Z"), direction: "in" as const },
      { punchedAt: new Date("2026-01-15T12:30:00.000Z"), direction: "out" as const },
    ];
    const kolkata = calcAttendance({
      workDate: "2026-01-15",
      timeZone: TZ,
      shift: DAY,
      punches,
    });
    const utc = calcAttendance({
      workDate: "2026-01-15",
      timeZone: "UTC",
      shift: DAY,
      punches,
    });
    expect(kolkata.lateMinutes).toBe(0);
    expect(utc.lateMinutes).toBe(0);
    // Same worked total, different clock reading for the arrival.
    expect(kolkata.workedMinutes).toBe(utc.workedMinutes);
  });
});

describe("resolving which day a punch belongs to", () => {
  it("uses the calendar date for a day shift", () => {
    expect(resolveWorkDate(at("2026-01-15", "09:00"), TZ, DAY)).toBe("2026-01-15");
    expect(resolveWorkDate(at("2026-01-15", "18:00"), TZ, DAY)).toBe("2026-01-15");
  });

  it("files an overnight check-in under the night it started", () => {
    expect(resolveWorkDate(at("2026-01-15", "22:00"), TZ, NIGHT)).toBe("2026-01-15");
  });

  it("files the morning check-out under the previous night", () => {
    // The bug this prevents: one night split across two records, each looking
    // like half a day to whoever reads the report.
    expect(resolveWorkDate(at("2026-01-16", "06:00"), TZ, NIGHT)).toBe("2026-01-15");
  });

  it("keeps a late departure with the night it belongs to", () => {
    expect(resolveWorkDate(at("2026-01-16", "06:30"), TZ, NIGHT)).toBe("2026-01-15");
    expect(resolveWorkDate(at("2026-01-16", "09:00"), TZ, NIGHT)).toBe("2026-01-15");
  });

  it("gives an early arrival to the night that is about to start", () => {
    expect(resolveWorkDate(at("2026-01-16", "21:00"), TZ, NIGHT)).toBe("2026-01-16");
  });

  it("splits at the midpoint between shift end and next start", () => {
    // 22:00-06:00 puts the boundary at 14:00.
    expect(resolveWorkDate(at("2026-01-16", "13:59"), TZ, NIGHT)).toBe("2026-01-15");
    expect(resolveWorkDate(at("2026-01-16", "14:00"), TZ, NIGHT)).toBe("2026-01-16");
  });

  it("reads the clock in the employee timezone, not the server's", () => {
    // 20:30 UTC is 02:00 next day in Kolkata — before the boundary, so it
    // belongs to the night that started on the 15th.
    expect(resolveWorkDate(new Date("2026-01-15T20:30:00.000Z"), TZ, NIGHT)).toBe("2026-01-15");
  });
});
