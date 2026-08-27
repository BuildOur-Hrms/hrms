import type { RunStatus } from "@/hooks/use-payroll";

/**
 * The vocabulary the payroll screens share.
 *
 * Here rather than repeated per tab, because a run that reads "Approved" on
 * one screen and "approved" on another looks like two different things.
 */

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function periodLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

export const RUN_LABEL: Record<RunStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  paid: "Paid",
};

/**
 * Colour carries the state, and the label carries it too.
 *
 * Never colour alone: "approved" and "paid" are a few pixels apart on a badge
 * and a long way apart in what they mean about somebody's money.
 */
export const RUN_TINT: Record<RunStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

export function employeeName(employee: { firstName: string; lastName: string | null }): string {
  return [employee.firstName, employee.lastName].filter(Boolean).join(" ");
}

/** The twelve months before now, newest first — what a payroll screen offers. */
export function recentPeriods(count = 18): { year: number; month: number }[] {
  const now = new Date();
  const out: { year: number; month: number }[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push({ year, month });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}
