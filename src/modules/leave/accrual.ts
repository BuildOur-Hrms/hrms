/**
 * Leave accrual and year-end carry-forward (docs/01-modules-core.md §7).
 *
 * Pure, like the day counter: these numbers become someone's balance, so they
 * must be reproducible from their inputs and testable without a database.
 *
 * Everything is in days, kept to two decimals — the column is
 * `numeric(5,2)`, and rounding here rather than at the database means the
 * number the service decided on is the number that gets stored.
 */

export type AccrualFrequency = "monthly" | "yearly" | "none";

export interface AccrualInput {
  frequency: AccrualFrequency;
  /** Days per period: per month for `monthly`, per year for `yearly`. */
  amount: number;
  year: number;
  /** 1–12. Required for `monthly`; ignored otherwise. */
  month?: number;
  /** `YYYY-MM-DD`. */
  joinDate: string;
  /** `YYYY-MM-DD`, when the person has left. */
  exitDate?: string | null;
  /**
   * The join month is credited only when the person started on or before
   * this day of it. A company setting, 15 by default: joining on the 2nd
   * earns the month, joining on the 28th does not.
   */
  joinCutoffDay: number;
}

/** Two decimals, the precision the balance columns actually hold. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/**
 * Whether a given month earns accrual for this employee.
 *
 * Three ways it does not: the month is before they joined, it is after they
 * left, or it is their join month and they started too late in it to count.
 */
export function monthEarnsAccrual(
  year: number,
  month: number,
  joinDate: string,
  exitDate: string | null | undefined,
  joinCutoffDay: number,
): boolean {
  const join = parts(joinDate);
  const index = year * 12 + month;
  const joinIndex = join.year * 12 + join.month;

  if (index < joinIndex) return false;
  if (index === joinIndex && join.day > joinCutoffDay) return false;

  if (exitDate) {
    const exit = parts(exitDate);
    const exitIndex = exit.year * 12 + exit.month;
    // The exit month itself is earned — they worked part of it, and the
    // alternative is charging someone for a month they were present in.
    if (index > exitIndex) return false;
  }

  return true;
}

/**
 * Days accrued for one period.
 *
 * `monthly` credits the flat amount for each month earned. `yearly` prorates
 * by how many of the twelve months were earned, which is what makes a
 * mid-year joiner get a fair share rather than a full year or nothing.
 */
export function accrualFor(input: AccrualInput): number {
  if (input.frequency === "none" || input.amount <= 0) return 0;

  if (input.frequency === "monthly") {
    if (!input.month) return 0;
    return monthEarnsAccrual(
      input.year,
      input.month,
      input.joinDate,
      input.exitDate,
      input.joinCutoffDay,
    )
      ? round2(input.amount)
      : 0;
  }

  const earned = Array.from({ length: 12 }, (_, i) => i + 1).filter((month) =>
    monthEarnsAccrual(input.year, month, input.joinDate, input.exitDate, input.joinCutoffDay),
  ).length;

  return round2((input.amount * earned) / 12);
}

export interface BalanceComponents {
  opening: number;
  accrued: number;
  used: number;
  carriedForward: number;
  adjusted: number;
}

/**
 * The number an employee actually sees.
 *
 * Derived rather than stored, so the parts and the total cannot drift apart.
 */
export function currentBalance(b: BalanceComponents): number {
  return round2(b.opening + b.accrued + b.carriedForward + b.adjusted - b.used);
}

/**
 * What survives into next year.
 *
 * Capped by policy, and never negative: an overdrawn balance is settled
 * against this year, not carried into the next one as a debt somebody has
 * forgotten the reason for.
 */
export function carryForwardAmount(closing: number, maxCarryForward: number): number {
  if (closing <= 0) return 0;
  return round2(Math.min(closing, Math.max(0, maxCarryForward)));
}

/**
 * Whether a request fits inside what the policy allows.
 *
 * `maxNegative` is how far below zero the balance may go, expressed as a
 * positive number of days. Zero — the default — means it may not.
 */
export function hasSufficientBalance(
  current: number,
  requestedDays: number,
  maxNegative: number,
): boolean {
  return round2(current - requestedDays) >= -Math.abs(maxNegative);
}
