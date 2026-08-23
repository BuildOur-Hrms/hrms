"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatCardsSkeleton, TableSkeleton } from "@/components/shared/skeletons";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api-client";

import { ReportFilters } from "./report-filters";
import {
  EMPTY_FILTERS,
  formatCell,
  type FilterState,
  type ReportDefinition,
  type ReportMeta,
  type ReportRow,
} from "./types";

/**
 * The reports screen: a catalog you pick from, then one generic runner.
 *
 * There is no per-report component and there should never be one. Columns,
 * filters and KPIs all arrive from the server catalog, so a report added in
 * `src/modules/reports` appears here with no change to this file — and the
 * headers can never drift from the rows underneath them.
 */

const PAGE_SIZE = 50;

export function ReportsWorkspace({ scope }: { scope: "all" | "team" }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const catalog = useQuery({
    queryKey: ["reports", "catalog"],
    queryFn: ({ signal }) =>
      api.get<{ reports: ReportDefinition[] }>("/reports", undefined, signal),
  });

  const available = useMemo(() => {
    const reports = catalog.data?.reports ?? [];
    // A company-wide report cannot be narrowed to a team, so the team screen
    // does not offer one it would have to refuse.
    return scope === "team" ? reports.filter((report) => report.teamScoped) : reports;
  }, [catalog.data, scope]);

  const report = available.find((r) => r.slug === slug) ?? null;

  // The catalog is a grid of cards, so it waits behind card-shaped
  // placeholders rather than a table's.
  if (catalog.isLoading) return <StatCardsSkeleton count={6} />;

  if (catalog.error) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Could not load the report catalog"
        description={catalog.error instanceof Error ? catalog.error.message : undefined}
      />
    );
  }

  if (!report) {
    return (
      <ReportCatalog
        reports={available}
        onPick={(next) => {
          setSlug(next);
          setPage(1);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{report.name}</h2>
          <p className="text-muted-foreground text-sm">{report.purpose}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSlug(null)}>
          <ArrowLeft className="size-4" />
          All reports
        </Button>
      </div>

      <ReportFilters
        report={report}
        filters={filters}
        onChange={(patch) => {
          setFilters((current) => ({ ...current, ...patch }));
          setPage(1);
        }}
      />

      <ReportTable report={report} filters={filters} scope={scope} page={page} onPage={setPage} />
    </div>
  );
}

function ReportCatalog({
  reports,
  onPick,
}: {
  reports: ReportDefinition[];
  onPick: (slug: string) => void;
}) {
  if (reports.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No reports available"
        description="Reports appear here as the modules they read from are enabled for you."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((report) => (
        <Card key={report.slug} className="hover:border-brand/40 transition-colors">
          <CardContent className="flex h-full flex-col items-start gap-3 p-5">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-mono text-[11px] font-normal">
                {report.id}
              </Badge>
              <p className="font-medium">{report.name}</p>
            </div>
            <p className="text-muted-foreground grow text-sm">{report.purpose}</p>
            <Button variant="outline" size="sm" onClick={() => onPick(report.slug)}>
              Run report
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Turn the screen's filter state into query parameters.
 *
 * Only what the report declared is sent. A stale value for a filter the
 * current report does not use stays in state — so it comes back when you
 * return to a report that does use it — without reaching the server.
 */
function buildParams(
  report: ReportDefinition,
  filters: FilterState,
  scope: "all" | "team",
  page: number,
): Record<string, string | number> {
  const wants = (name: string) => report.filters.includes(name as never);
  const params: Record<string, string | number> = { page, pageSize: PAGE_SIZE, scope };

  if (wants("dateRange")) {
    if (filters.from) params["from"] = filters.from;
    if (filters.to) params["to"] = filters.to;
  }
  if (wants("month") && filters.month) {
    params["year"] = filters.month.slice(0, 4);
    params["month"] = filters.month.slice(5, 7);
  }
  if (wants("year") && filters.year) params["year"] = filters.year;
  if (wants("department") && filters.departmentId) params["departmentId"] = filters.departmentId;
  if (wants("location") && filters.locationId) params["locationId"] = filters.locationId;
  if (wants("leaveType") && filters.leaveTypeId) params["leaveTypeId"] = filters.leaveTypeId;
  if (wants("status") && filters.status) params["status"] = filters.status;
  if (wants("employmentType") && filters.employmentType) {
    params["employmentType"] = filters.employmentType;
  }
  if (wants("groupBy") && filters.groupBy) params["groupBy"] = filters.groupBy;
  if (wants("lateThreshold") && filters.lateThresholdMinutes) {
    params["lateThresholdMinutes"] = filters.lateThresholdMinutes;
  }
  if (wants("action") && filters.action) params["action"] = filters.action;
  if (wants("entityType") && filters.entityType) params["entityType"] = filters.entityType;

  return params;
}

function ReportTable({
  report,
  filters,
  scope,
  page,
  onPage,
}: {
  report: ReportDefinition;
  filters: FilterState;
  scope: "all" | "team";
  page: number;
  onPage: (page: number) => void;
}) {
  const params = useMemo(
    () => buildParams(report, filters, scope, page),
    [report, filters, scope, page],
  );

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["report", report.slug, params],
    queryFn: ({ signal }) =>
      api.list<ReportRow, ReportMeta>(`/reports/${report.slug}`, params, signal),
    placeholderData: keepPreviousData,
  });

  if (error) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Could not run this report"
        description={error instanceof Error ? error.message : undefined}
      />
    );
  }

  if (isLoading) return <TableSkeleton rows={8} columns={report.columns.length} />;

  const rows = data?.data ?? [];
  const meta = data?.meta;
  const columns = meta?.columns ?? report.columns;
  const total = meta?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      {meta && meta.kpis.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {meta.kpis.map((kpi) => (
            <StatCard
              key={kpi.label}
              label={kpi.label}
              value={formatCell(kpi.value, kpi.format)}
              icon={BarChart3}
            />
          ))}
        </div>
      ) : null}

      {meta?.breakdown && meta.breakdown.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {meta.breakdown.map((group) => (
            <Badge key={group.label} variant="secondary" className="font-normal">
              {group.label}
              <span className="ml-1.5 tabular-nums">{group.count}</span>
            </Badge>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Nothing matches these filters"
          description="Widen the range, or clear a filter, and run it again."
        />
      ) : (
        <>
          <div className="bg-card overflow-x-auto rounded-xl border shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead key={column.key} className="whitespace-nowrap">
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={String(row["id"] ?? index)}>
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={
                          column.format && column.format !== "text" && column.format !== "date"
                            ? "whitespace-nowrap tabular-nums"
                            : "whitespace-nowrap"
                        }
                      >
                        {formatCell(row[column.key] ?? null, column.format)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">
              {total} row{total === 1 ? "" : "s"}
              {isFetching ? " · updating…" : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => onPage(page - 1)}
              >
                Previous
              </Button>
              <span className="text-muted-foreground text-sm">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => onPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
