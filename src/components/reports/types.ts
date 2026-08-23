import type { ListMeta } from "@/lib/api-client";
import type { ReportColumn, ReportDefinition } from "@/modules/reports/catalog";

/**
 * Wire types for the reports screen.
 *
 * The column and definition types come straight from the server catalog
 * rather than being restated here — they are type-only imports, so nothing
 * server-side is pulled into the bundle, and a column added to a report
 * cannot go missing from the table.
 */

export type { ReportColumn, ReportDefinition };

export type ReportRow = Record<string, string | number | boolean | null>;

export interface ReportMeta extends ListMeta {
  scope: "all" | "team";
  report: { id: string; slug: string; name: string; purpose: string };
  columns: ReportColumn[];
  kpis: { label: string; value: string | number; format?: ReportColumn["format"] }[];
  breakdown?: { label: string; count: number }[];
}

/** Every filter the screen can hold, before it is trimmed to the report. */
export interface FilterState {
  from: string;
  to: string;
  month: string;
  year: string;
  departmentId: string;
  locationId: string;
  leaveTypeId: string;
  status: string;
  employmentType: string;
  lateThresholdMinutes: string;
  groupBy: string;
  action: string;
  entityType: string;
}

export const EMPTY_FILTERS: FilterState = {
  from: "",
  to: "",
  month: "",
  year: "",
  departmentId: "",
  locationId: "",
  leaveTypeId: "",
  status: "",
  employmentType: "",
  lateThresholdMinutes: "",
  groupBy: "",
  action: "",
  entityType: "",
};

/** Sentinel for "no filter", because a Select cannot hold an empty value. */
export const ANY = "__any__";

export function formatCell(value: ReportRow[string], format: ReportColumn["format"]): string {
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  switch (format) {
    case "datetime":
      return new Date(String(value)).toLocaleString();
    case "time":
      return new Date(String(value)).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
    case "minutes":
      return `${value}m`;
    case "percent":
      return `${value}%`;
    default:
      return String(value);
  }
}
