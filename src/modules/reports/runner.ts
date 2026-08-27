import { NOBODY, type RequestContext } from "@/lib/context";
import { ForbiddenError } from "@/lib/errors";
import { requirePermission, resolveScope } from "@/lib/permissions";

import type { ColumnFormat, ReportDefinition } from "./catalog";
import type { ReportQueryInput, ReportScope } from "./validators";

/**
 * The contract every report runner is written against.
 *
 * A runner receives an already-resolved scope and never re-derives it, so
 * "which people am I allowed to count" is decided in exactly one place. Rows
 * come back flat and pre-formatted-as-values (dates as `YYYY-MM-DD`, minutes
 * as numbers), because the screen renders columns from the catalog and has no
 * knowledge of any particular report.
 */

export type ReportRow = Record<string, string | number | boolean | null>;

export interface ReportKpi {
  label: string;
  value: string | number;
  format?: ColumnFormat;
}

export interface ReportResult {
  rows: ReportRow[];
  /** Rows matching the filters, before pagination. */
  total: number;
  kpis: ReportKpi[];
  /** Counts per group when the report was asked to group (R1). */
  breakdown?: { label: string; count: number }[];
}

export interface RunnerArgs {
  ctx: RequestContext;
  scope: ReportScope;
  query: ReportQueryInput;
}

export type ReportRunner = (args: RunnerArgs) => Promise<ReportResult>;

/**
 * Decide which scope this call runs at, and refuse it if the caller cannot
 * have it.
 *
 * Asking for nothing means "the widest scope you hold" — a manager opening a
 * report gets their team without having to know that is what they are limited
 * to, and an HR admin gets the company.
 */
export function resolveReportScope(
  ctx: RequestContext,
  report: ReportDefinition,
  requested?: ReportScope,
): ReportScope {
  const widest = resolveScope(ctx, "reports");
  if (widest !== "all" && widest !== "team") {
    throw new ForbiddenError("You cannot run reports");
  }

  const scope = requested ?? (widest === "all" ? "all" : "team");

  if (scope === "all" && widest !== "all") {
    throw new ForbiddenError("You can only run reports over your own team");
  }
  if (scope === "team" && !report.teamScoped) {
    throw new ForbiddenError(`${report.name} is a company-wide report`);
  }
  if (report.extraPermission) requirePermission(ctx, report.extraPermission);

  return scope;
}

/**
 * The employee filter for a scope, as a Prisma `where` fragment.
 *
 * Team scope is direct reports only — not the whole reporting tree. A skip
 * level manager sees their own reports' data, and that is the same boundary
 * the approval queues use, so the two can never disagree about who is "the
 * team".
 */
export function employeeScopeWhere(
  ctx: RequestContext,
  scope: ReportScope,
): Record<string, unknown> {
  if (scope === "all") return {};
  return { managerId: ctx.employeeId ?? NOBODY };
}

export function fullName(employee: { firstName: string; lastName: string | null }): string {
  return [employee.firstName, employee.lastName].filter(Boolean).join(" ");
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `on_notice` → `On notice`. Enum values are for code, not for readers. */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** One decimal place, and never `-0`. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
