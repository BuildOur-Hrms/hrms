import type { RequestContext } from "@/lib/context";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { resolveScope } from "@/lib/permissions";

import { auditActivity } from "./audit-activity";
import { reportBySlug, visibleReports, type ReportColumn, type ReportDefinition } from "./catalog";
import { headcount } from "./headcount";
import { resolveReportScope, type ReportKpi, type ReportRow, type ReportRunner } from "./runner";
import type { ReportQueryInput, ReportScope } from "./validators";

/**
 * Running a report: resolve the definition, resolve the scope, hand off.
 *
 * The dispatcher is the only place that knows every report, and it stays a
 * flat lookup on purpose — a report is a pure read with no lifecycle, so
 * there is nothing here to be clever about.
 */

const RUNNERS: Record<string, ReportRunner> = {
  headcount,
  "audit-activity": auditActivity,
};

export interface ReportRun {
  data: ReportRow[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    scope: ReportScope;
    report: { id: string; slug: string; name: string; purpose: string };
    columns: readonly ReportColumn[];
    kpis: ReportKpi[];
    breakdown?: { label: string; count: number }[];
  };
}

export async function runReport(
  ctx: RequestContext,
  slug: string,
  query: ReportQueryInput,
): Promise<ReportRun> {
  const report = reportBySlug(slug);
  const runner = report ? RUNNERS[report.slug] : undefined;
  // An unknown report is a 404 rather than a 422: the name is the resource.
  if (!report || !runner) throw new NotFoundError("Report not found");

  const scope = resolveReportScope(ctx, report, query.scope);
  const result = await runner({ ctx, scope, query });

  return {
    data: result.rows,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
      scope,
      report: { id: report.id, slug: report.slug, name: report.name, purpose: report.purpose },
      columns: report.columns,
      kpis: result.kpis,
      ...(result.breakdown ? { breakdown: result.breakdown } : {}),
    },
  };
}

/**
 * The catalog grid: every report this caller may run, already filtered.
 *
 * Filtering here rather than in the screen means a manager never sees a tile
 * that 403s when clicked.
 */
export function listReports(ctx: RequestContext): ReportDefinition[] {
  const scope = resolveScope(ctx, "reports");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("You cannot run reports");
  return visibleReports(ctx.permissions);
}
