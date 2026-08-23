import type { PermissionCode } from "@/lib/permissions";

/**
 * The report catalog (docs/03-modules-platform-and-reports.md §Module 20), as
 * data.
 *
 * Every report describes its own columns and the filters it accepts, so one
 * generic screen can render all of them and a new report is a runner plus an
 * entry here — never a new page. The same definitions drive the catalog grid,
 * the table header and (Phase 2) the export column order, which is what stops
 * those three from drifting apart.
 *
 * Only the Phase 1 reports live here. R5, R8–R15 arrive with the modules they
 * read from.
 */

export type ColumnFormat =
  "text" | "number" | "date" | "datetime" | "time" | "minutes" | "days" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  /** How the cell is rendered. Defaults to `text`. */
  format?: ColumnFormat;
}

/**
 * Filter controls the report screen knows how to draw. A report lists the
 * ones it honours; anything else it is sent is ignored rather than rejected,
 * so a stale bookmark still runs.
 */
export type ReportFilter =
  | "dateRange"
  | "month"
  | "year"
  | "department"
  | "location"
  | "status"
  | "employmentType"
  | "leaveType"
  | "lateThreshold"
  | "groupBy"
  | "action"
  | "entityType"
  | "actor";

export interface ReportDefinition {
  /** Catalog number, e.g. `R1`. Stable across renames. */
  id: string;
  /** URL segment: `/api/v1/reports/:slug`. */
  slug: string;
  name: string;
  purpose: string;
  columns: readonly ReportColumn[];
  filters: readonly ReportFilter[];
  /** Whether a manager may run a direct-reports-only variant. */
  teamScoped: boolean;
  /**
   * Held in addition to `reports.view_all` / `reports.view_team`. Reports over
   * sensitive tables carry the owning module's permission too, so granting
   * someone "reports" does not quietly hand them the audit trail.
   */
  extraPermission?: PermissionCode;
}

export const REPORTS: readonly ReportDefinition[] = [
  {
    id: "R1",
    slug: "headcount",
    name: "Headcount",
    purpose: "Current workforce composition.",
    teamScoped: true,
    filters: ["department", "location", "status", "employmentType", "groupBy"],
    columns: [
      { key: "employee", label: "Employee" },
      { key: "employeeCode", label: "Code" },
      { key: "department", label: "Department" },
      { key: "designation", label: "Designation" },
      { key: "location", label: "Location" },
      { key: "employmentType", label: "Type" },
      { key: "status", label: "Status" },
      { key: "joinDate", label: "Joined", format: "date" },
    ],
  },
  {
    id: "R2",
    slug: "attendance-summary",
    name: "Attendance summary",
    purpose: "How a month went, one row per person.",
    teamScoped: true,
    filters: ["month", "department", "location"],
    columns: [
      { key: "employee", label: "Employee" },
      { key: "employeeCode", label: "Code" },
      { key: "department", label: "Department" },
      { key: "present", label: "Present", format: "number" },
      { key: "absent", label: "Absent", format: "number" },
      { key: "halfDay", label: "Half day", format: "number" },
      { key: "onLeave", label: "On leave", format: "number" },
      { key: "holiday", label: "Holiday", format: "number" },
      { key: "weekOff", label: "Week off", format: "number" },
      { key: "workedHours", label: "Worked hrs", format: "number" },
      { key: "overtimeHours", label: "OT hrs", format: "number" },
      { key: "presencePercent", label: "Presence", format: "percent" },
    ],
  },
  {
    id: "R3",
    slug: "absences",
    name: "Absence report",
    purpose: "Days nobody has explained: absent, with no approved leave.",
    teamScoped: true,
    filters: ["dateRange", "department", "location"],
    columns: [
      { key: "date", label: "Date", format: "date" },
      { key: "employee", label: "Employee" },
      { key: "employeeCode", label: "Code" },
      { key: "department", label: "Department" },
      { key: "shift", label: "Expected shift" },
      { key: "shiftStart", label: "Starts" },
    ],
  },
  {
    id: "R4",
    slug: "late-arrivals",
    name: "Late arrivals",
    purpose: "Punctuality against each person's own shift and grace period.",
    teamScoped: true,
    filters: ["dateRange", "department", "location", "lateThreshold"],
    columns: [
      { key: "date", label: "Date", format: "date" },
      { key: "employee", label: "Employee" },
      { key: "employeeCode", label: "Code" },
      { key: "department", label: "Department" },
      { key: "shiftStart", label: "Shift start" },
      { key: "checkIn", label: "Checked in", format: "time" },
      { key: "lateMinutes", label: "Late by", format: "minutes" },
    ],
  },
  {
    id: "R16",
    slug: "audit-activity",
    name: "Audit activity",
    purpose: "Sensitive-action review: who did what, to what, and when.",
    teamScoped: false,
    extraPermission: "audit.view_all",
    filters: ["dateRange", "action", "entityType", "actor"],
    columns: [
      { key: "at", label: "When", format: "datetime" },
      { key: "actor", label: "Actor" },
      { key: "action", label: "Action" },
      { key: "entity", label: "Entity" },
      { key: "summary", label: "Summary" },
    ],
  },
];

export function reportBySlug(slug: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.slug === slug);
}

/** The catalog a caller may see, given what they hold. */
export function visibleReports(permissions: ReadonlySet<PermissionCode>): ReportDefinition[] {
  const all = permissions.has("reports.view_all");
  const team = permissions.has("reports.view_team");
  if (!all && !team) return [];

  return REPORTS.filter((report) => {
    if (!all && !report.teamScoped) return false;
    if (report.extraPermission && !permissions.has(report.extraPermission)) return false;
    return true;
  });
}
