/**
 * How many days a leave request actually costs (docs/01-modules-core.md §7).
 *
 * Pure, for the same reasons the attendance calculator is: this number is
 * deducted from someone's balance, so it has to be reproducible from its
 * inputs alone and testable without a database. The caller resolves which
 * dates are holidays and which weekdays are off; this decides what that means.
 */

export type HalfDayPart = "none" | "first_half" | "second_half";

export interface DayCountInput {
  /** `YYYY-MM-DD`, inclusive. */
  startDate: string;
  /** `YYYY-MM-DD`, inclusive. */
  endDate: string;
  halfDay: HalfDayPart;
  /** 0=Sunday … 6=Saturday, from the shift in force. */
  weekOffDays: number[];
  /** `YYYY-MM-DD` dates that are holidays for this employee's location. */
  holidays: readonly string[];
  /**
   * When on, non-working days *inside* the span are charged as leave.
   * Adjacent ones never are — see `countLeaveDays` for why that distinction
   * is the entire rule.
   */
  sandwichRule: boolean;
}

export type DayKind = "working" | "week_off" | "holiday";

export interface CountedDay {
  date: string;
  kind: DayKind;
  /** Days charged for this date: 1, 0.5 or 0. */
  charged: number;
}

export interface DayCountResult {
  days: number;
  breakdown: CountedDay[];
}

const MS_PER_DAY = 86_400_000;

function parse(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every date from start to end inclusive. */
export function datesBetween(startDate: string, endDate: string): string[] {
  const start = parse(startDate);
  const end = parse(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const out: string[] = [];
  for (let t = start; t <= end; t += MS_PER_DAY) out.push(iso(t));
  return out;
}

function classify(date: string, weekOffDays: readonly number[], holidays: Set<string>): DayKind {
  // Holiday wins over week-off so a holiday landing on a Sunday is reported
  // as the holiday it is, rather than disappearing into the weekend.
  if (holidays.has(date)) return "holiday";
  return weekOffDays.includes(new Date(`${date}T00:00:00.000Z`).getUTCDay())
    ? "week_off"
    : "working";
}

/**
 * Count the leave days in a span.
 *
 * The sandwich rule is the one genuinely subtle thing here. When it is on, a
 * weekend *between* two leave days is charged — taking Friday and Monday off
 * costs four days, because the person was away all weekend too. A weekend
 * *next to* the span is never charged, however the rule is set: leaving on
 * Friday does not make you pay for the Saturday you were never going to work.
 *
 * So the span is trimmed to its first and last working day before the rule is
 * applied, and everything outside that window is free regardless.
 */
export function countLeaveDays(input: DayCountInput): DayCountResult {
  const holidays = new Set(input.holidays);
  const dates = datesBetween(input.startDate, input.endDate);

  if (dates.length === 0) return { days: 0, breakdown: [] };

  const kinds = dates.map((date) => ({
    date,
    kind: classify(date, input.weekOffDays, holidays),
  }));

  const firstWorking = kinds.findIndex((d) => d.kind === "working");
  // A span made entirely of holidays and week-offs costs nothing, whatever
  // the sandwich rule says — there was no working day to be absent from.
  if (firstWorking === -1) {
    return { days: 0, breakdown: kinds.map((d) => ({ ...d, charged: 0 })) };
  }
  let lastWorking = kinds.length - 1;
  while (kinds[lastWorking]!.kind !== "working") lastWorking--;

  const breakdown: CountedDay[] = kinds.map((day, index) => {
    const inside = index >= firstWorking && index <= lastWorking;
    const chargeable = day.kind === "working" || (input.sandwichRule && inside);
    return { ...day, charged: chargeable ? 1 : 0 };
  });

  let days = breakdown.reduce((total, day) => total + day.charged, 0);

  // Half a day is only meaningful on a single-day request; the database
  // refuses the multi-day case, and this mirrors it rather than guessing
  // which half of a fortnight someone meant.
  if (input.halfDay !== "none" && input.startDate === input.endDate && days === 1) {
    days = 0.5;
    breakdown[0]!.charged = 0.5;
  }

  return { days, breakdown };
}

/**
 * Split a span at a leave-year boundary.
 *
 * A request from 28 December to 3 January is two requests as far as balances
 * are concerned: each year has its own accrual and its own carry-forward cap,
 * and charging the whole thing to one of them would overdraw a year that
 * still has days left in it.
 */
export function splitAtYearBoundary(
  startDate: string,
  endDate: string,
): { year: number; startDate: string; endDate: string }[] {
  const dates = datesBetween(startDate, endDate);
  if (dates.length === 0) return [];

  const segments: { year: number; startDate: string; endDate: string }[] = [];
  for (const date of dates) {
    const year = Number(date.slice(0, 4));
    const last = segments.at(-1);
    if (last && last.year === year) last.endDate = date;
    else segments.push({ year, startDate: date, endDate: date });
  }
  return segments;
}
