import { TZDate } from "@date-fns/tz";

/**
 * The attendance calculator (docs/01-modules-core.md §Module 5).
 *
 * Deliberately pure: no database, no clock of its own, no ambient timezone.
 * Everything it needs is an argument, so a day can be recomputed years later
 * and produce the same answer, and so the rules can be tested exhaustively
 * without a fixture database. The nightly job and the correction flow both
 * call this; neither owns the rules.
 *
 * It also does not read leave or holidays. Those are M3 tables that do not
 * exist yet, and even once they do, a calculator that queries is a calculator
 * you cannot test — so the caller resolves them and passes booleans in.
 */

export type AttendanceStatusValue =
  "present" | "absent" | "half_day" | "on_leave" | "holiday" | "week_off";

export interface ShiftRules {
  /** `HH:MM` wall clock in `timeZone`. */
  startTime: string;
  /** `HH:MM`; earlier than `startTime` means the shift crosses midnight. */
  endTime: string;
  graceMinutes: number;
  halfDayThresholdMinutes: number;
  /** Scheduled unpaid break. See `workedMinutes` below for how it is applied. */
  breakMinutes: number;
  /** 0=Sunday … 6=Saturday. */
  weekOffDays: number[];
}

export interface PunchInput {
  punchedAt: Date;
  direction: "in" | "out";
}

export interface CalcInput {
  /** The calendar date being computed, as `YYYY-MM-DD` in `timeZone`. */
  workDate: string;
  /** IANA zone the shift's wall clock refers to. */
  timeZone: string;
  shift: ShiftRules;
  punches: PunchInput[];
  /** Resolved by the caller from the holiday calendar (M3). */
  isHoliday?: boolean;
  /** Resolved by the caller from approved leave (M3). */
  isOnLeave?: boolean;
}

export interface CalcResult {
  status: AttendanceStatusValue;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  /** The day cannot be trusted as-is and a human should look at it. */
  needsReview: boolean;
}

const MINUTES_PER_DAY = 1440;

function parseHhMm(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/** Minutes the shift spans, wrapping midnight when it has to. */
export function shiftSpanMinutes(startTime: string, endTime: string): number {
  const start = parseHhMm(startTime);
  const end = parseHhMm(endTime);
  return end > start ? end - start : MINUTES_PER_DAY - start + end;
}

/** `YYYY-MM-DD` for an instant, as seen in `timeZone`. */
function localDate(instant: Date, timeZone: string): string {
  const zoned = new TZDate(instant, timeZone);
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, "0");
  const d = String(zoned.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Minutes past local midnight for an instant, as seen in `timeZone`. */
function localMinutes(instant: Date, timeZone: string): number {
  const zoned = new TZDate(instant, timeZone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

/** Whole days between two `YYYY-MM-DD` strings. */
function dayDelta(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Which weekday `workDate` falls on. Parsed as UTC deliberately — the string
 * already names a calendar date, so no zone conversion should touch it.
 */
function weekdayOf(workDate: string): number {
  return new Date(`${workDate}T00:00:00.000Z`).getUTCDay();
}

/**
 * Which work date a punch belongs to.
 *
 * For a day shift this is simply the local calendar date. For an overnight
 * shift it is not: someone clocking out at 06:00 is finishing the shift that
 * began the previous evening, and filing that punch under the new calendar day
 * would split one night's work across two records — each looking like half a
 * day to anyone reading the report.
 *
 * The boundary sits at the midpoint between when the shift ends and when the
 * next one starts (14:00 for a 22:00–06:00 shift). That is symmetric, so it
 * handles both ends of the same problem: a punch at 06:30 from someone who
 * stayed late still belongs to last night, and a punch at 21:00 from someone
 * arriving early belongs to tonight.
 */
export function resolveWorkDate(
  punchedAt: Date,
  timeZone: string,
  shift: Pick<ShiftRules, "startTime" | "endTime">,
): string {
  const start = parseHhMm(shift.startTime);
  const end = parseHhMm(shift.endTime);
  const local = localDate(punchedAt, timeZone);

  // Not an overnight shift: the calendar date is the work date.
  if (end > start) return local;

  const boundary = (end + start) / 2;
  if (localMinutes(punchedAt, timeZone) >= boundary) return local;

  const previous = new Date(Date.parse(`${local}T00:00:00.000Z`) - 86_400_000);
  return previous.toISOString().slice(0, 10);
}

interface Segment {
  in: Date;
  out: Date;
}

/**
 * Pair punches into worked segments.
 *
 * Real punch streams are messy: a double check-in because the first tap did
 * not register, a check-out with no matching check-in after a correction. The
 * rule is to take the earliest `in` of a run and close it on the next `out`,
 * and to report anything left over rather than guessing at it.
 */
export function pairPunches(punches: PunchInput[]): {
  segments: Segment[];
  openIn: Date | null;
  strayOut: boolean;
} {
  const ordered = [...punches].sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime());

  const segments: Segment[] = [];
  let openIn: Date | null = null;
  let strayOut = false;

  for (const punch of ordered) {
    if (punch.direction === "in") {
      // A second `in` while one is open is a duplicate tap; the earlier one
      // stands, because that is when the person actually arrived.
      openIn ??= punch.punchedAt;
    } else if (openIn) {
      segments.push({ in: openIn, out: punch.punchedAt });
      openIn = null;
    } else {
      // An `out` with nothing open cannot be measured against anything.
      strayOut = true;
    }
  }

  return { segments, openIn, strayOut };
}

/**
 * Compute one employee-day.
 *
 * Status precedence is leave, then holiday, then week-off, then what the
 * punches say. Approved leave outranks a holiday so a booked day is not
 * silently handed back when the holiday calendar changes later.
 */
export function calcAttendance(input: CalcInput): CalcResult {
  const { workDate, timeZone, shift, punches } = input;

  const { segments, openIn, strayOut } = pairPunches(punches);

  const firstIn = segments[0]?.in ?? openIn ?? null;
  const lastOut = segments.length > 0 ? segments[segments.length - 1]!.out : null;

  const pairedMinutes = segments.reduce(
    (total, s) => total + Math.round((s.out.getTime() - s.in.getTime()) / 60_000),
    0,
  );

  /*
   * The break is unpaid, but punching out for lunch already removes that time
   * from `pairedMinutes`. Deducting the full scheduled break on top would
   * charge it twice and penalise the person who punched honestly, so only the
   * part not already covered by a gap between segments is deducted.
   */
  const gapMinutes = segments
    .slice(1)
    .reduce(
      (total, s, i) => total + Math.round((s.in.getTime() - segments[i]!.out.getTime()) / 60_000),
      0,
    );
  const unpaidBreak = Math.max(0, shift.breakMinutes - gapMinutes);
  const workedMinutes = Math.max(0, pairedMinutes - unpaidBreak);

  // Lateness is measured from the shift start, which for an overnight shift
  // may be on `workDate` while the punch lands on the next calendar day.
  let lateMinutes = 0;
  if (firstIn) {
    const offsetDays = dayDelta(workDate, localDate(firstIn, timeZone));
    const minutesFromStart =
      offsetDays * MINUTES_PER_DAY + localMinutes(firstIn, timeZone) - parseHhMm(shift.startTime);
    lateMinutes = Math.max(0, minutesFromStart - shift.graceMinutes);
  }

  const isWeekOff = shift.weekOffDays.includes(weekdayOf(workDate));
  const scheduledMinutes = Math.max(
    0,
    shiftSpanMinutes(shift.startTime, shift.endTime) - shift.breakMinutes,
  );

  // Time worked on a day nobody was scheduled is overtime in full.
  const offDay = isWeekOff || input.isHoliday === true || input.isOnLeave === true;
  const overtimeMinutes = offDay ? workedMinutes : Math.max(0, workedMinutes - scheduledMinutes);

  // An `in` with no `out` means the day is unfinished; a stray `out` means the
  // stream is inconsistent. Either way a human decides, not this function.
  const needsReview = openIn !== null || strayOut;

  const status: AttendanceStatusValue = input.isOnLeave
    ? "on_leave"
    : input.isHoliday
      ? "holiday"
      : isWeekOff
        ? "week_off"
        : segments.length === 0
          ? "absent"
          : workedMinutes < shift.halfDayThresholdMinutes
            ? "half_day"
            : "present";

  // Lateness is meaningless on a day there was no shift to be late for.
  return {
    status,
    firstIn,
    lastOut,
    workedMinutes,
    lateMinutes: offDay ? 0 : lateMinutes,
    overtimeMinutes,
    needsReview,
  };
}
