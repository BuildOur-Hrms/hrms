/**
 * What somebody is owed for a month.
 *
 * Pure, and deliberately the smallest thing that can be correct: days worked
 * in, a list of lines out. Every hard question in payroll is a rounding
 * question, so all of them are answered here where they can be argued about
 * against examples rather than discovered on a payslip.
 *
 * Money is integer minor units — paise, cents. There is no floating point
 * anywhere in this file, because there is no amount of care that makes
 * floating-point money add up reliably.
 */

export type ComponentKind = "earning" | "deduction";

export interface Component {
  code: string;
  name: string;
  kind: ComponentKind;
  /** Whether loss of pay shrinks it. */
  prorates: boolean;
  sortOrder: number;
  /** A fixed monthly amount, in minor units. */
  amountMinor?: number | null;
  /** Or a percentage of another component's line, after proration. */
  percentOf?: { code: string; percent: number } | null;
}

export interface PayslipLine {
  code: string;
  name: string;
  kind: ComponentKind;
  amountMinor: number;
  sortOrder: number;
}

export interface Payslip {
  periodDays: number;
  lopDays: number;
  payableDays: number;
  lines: PayslipLine[];
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
}

/**
 * Round to a whole minor unit, half away from zero.
 *
 * `Math.round` breaks ties upward, which for a negative amount rounds towards
 * zero — so a deduction of −2.5 becomes −2 while an earning of 2.5 becomes 3,
 * and the same half-unit is treated two different ways in one payslip.
 */
export function roundMinor(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Prorate an amount by the days actually payable.
 *
 * Done as one multiply-then-divide rather than by computing a factor first:
 * a factor is a fraction, and turning it into a fraction before multiplying
 * is where the missing rupee comes from.
 */
export function prorate(amountMinor: number, payableDays: number, periodDays: number): number {
  if (periodDays <= 0) return 0;
  if (payableDays >= periodDays) return amountMinor;
  return roundMinor((amountMinor * payableDays) / periodDays);
}

/**
 * Loss of pay for a month, in days.
 *
 * Absence with nothing covering it costs a day. A half day costs half. Leave
 * costs nothing unless the leave type is unpaid, which is the entire reason
 * payroll sits next to attendance rather than in the finance system: nobody
 * over there knows who was off.
 *
 * Holidays and week-offs cost nothing. Somebody absent for a whole month is
 * still paid for the Sundays in it, which is what monthly salary means.
 */
export interface AttendanceDay {
  status: "present" | "absent" | "half_day" | "on_leave" | "holiday" | "week_off";
  /** True when the day was covered by leave of a type that does not pay. */
  unpaidLeave?: boolean;
}

export function lopDaysFor(days: AttendanceDay[]): number {
  let lop = 0;
  for (const day of days) {
    if (day.status === "absent") lop += 1;
    else if (day.status === "half_day") lop += 0.5;
    else if (day.status === "on_leave" && day.unpaidLeave) lop += 1;
  }
  // Halves only, so a float comparison never has to be trusted.
  return Math.round(lop * 2) / 2;
}

/**
 * The month's pay, line by line.
 *
 * Percentage components are worked out from the *prorated* line they point
 * at, not from the full-month figure. Provident fund at 12% of a basic that
 * was itself cut by three days of unpaid leave is 12% of what was actually
 * earned — anything else deducts against money nobody received.
 *
 * The totals are the sum of the rounded lines rather than a rounding of the
 * true total. A payslip has to add up on the page; a total that is a rupee
 * away from its own lines is the kind of thing people stop trusting a system
 * over.
 */
export function computePayslip(input: {
  components: Component[];
  periodDays: number;
  lopDays: number;
}): Payslip {
  const periodDays = input.periodDays;
  const lopDays = Math.min(Math.max(input.lopDays, 0), periodDays);
  const payableDays = periodDays - lopDays;

  const ordered = [...input.components].sort((a, b) => a.sortOrder - b.sortOrder);

  // Fixed lines first: a percentage line can only be a percentage of a line
  // that already has a number.
  const byCode = new Map<string, number>();
  const lines: PayslipLine[] = [];

  for (const component of ordered) {
    if (component.percentOf) continue;

    const full = component.amountMinor ?? 0;
    const amount = component.prorates ? prorate(full, payableDays, periodDays) : full;
    byCode.set(component.code, amount);
    lines.push({
      code: component.code,
      name: component.name,
      kind: component.kind,
      amountMinor: amount,
      sortOrder: component.sortOrder,
    });
  }

  for (const component of ordered) {
    if (!component.percentOf) continue;

    // A percentage of a component that is not on this person's salary is
    // zero, not an error: somebody with no basic pay has no PF to deduct.
    const base = byCode.get(component.percentOf.code) ?? 0;
    const amount = roundMinor((base * component.percentOf.percent) / 100);

    byCode.set(component.code, amount);
    lines.push({
      code: component.code,
      name: component.name,
      kind: component.kind,
      amountMinor: amount,
      sortOrder: component.sortOrder,
    });
  }

  lines.sort((a, b) => a.sortOrder - b.sortOrder);

  const grossMinor = lines
    .filter((line) => line.kind === "earning")
    .reduce((sum, line) => sum + line.amountMinor, 0);
  const deductionsMinor = lines
    .filter((line) => line.kind === "deduction")
    .reduce((sum, line) => sum + line.amountMinor, 0);

  return {
    periodDays,
    lopDays,
    payableDays,
    lines,
    grossMinor,
    deductionsMinor,
    // Deliberately allowed to go negative. A recovery larger than the month's
    // pay is a real thing, and showing zero would hide money still owed.
    netMinor: grossMinor - deductionsMinor,
  };
}

/** Days in a calendar month, which is the default period. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
