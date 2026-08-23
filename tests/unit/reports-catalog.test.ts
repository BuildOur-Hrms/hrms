import { describe, expect, it } from "vitest";

import type { RequestContext } from "@/lib/context";
import { ForbiddenError } from "@/lib/errors";
import type { PermissionCode } from "@/lib/permissions";
import { blankTally, presenceRate } from "@/modules/reports/attendance";
import { REPORTS, reportBySlug, visibleReports } from "@/modules/reports/catalog";
import { employeeScopeWhere, resolveReportScope } from "@/modules/reports/runner";
import { RUNNABLE_SLUGS } from "@/modules/reports/service";

/**
 * The catalog is the contract between the screen, the endpoint and the runner.
 * These assertions keep the three from drifting, and pin the scope rules —
 * which are the only place a report can leak somebody else's people.
 */

const ctx = (codes: PermissionCode[], employeeId: string | null = "emp-1") =>
  ({ permissions: new Set(codes), employeeId }) as unknown as RequestContext;

const headcount = reportBySlug("headcount")!;
const audit = reportBySlug("audit-activity")!;

describe("report catalog", () => {
  it("has a unique id and slug per report", () => {
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(REPORTS.length);
    expect(new Set(REPORTS.map((r) => r.slug)).size).toBe(REPORTS.length);
  });

  it("has a runner for every catalog entry, and nothing spare", () => {
    expect(REPORTS.map((r) => r.slug).sort()).toEqual([...RUNNABLE_SLUGS].sort());
  });

  it("gives every report at least one column", () => {
    for (const report of REPORTS) {
      expect(report.columns.length).toBeGreaterThan(0);
      expect(new Set(report.columns.map((c) => c.key)).size).toBe(report.columns.length);
    }
  });

  it("shows a manager only the team-scoped reports", () => {
    const slugs = visibleReports(new Set<PermissionCode>(["reports.view_team"])).map((r) => r.slug);
    expect(slugs).toContain("headcount");
    expect(slugs).not.toContain("audit-activity");
  });

  it("hides a report whose extra permission is missing", () => {
    const slugs = visibleReports(new Set<PermissionCode>(["reports.view_all"])).map((r) => r.slug);
    expect(slugs).not.toContain("audit-activity");

    const withAudit = visibleReports(
      new Set<PermissionCode>(["reports.view_all", "audit.view_all"]),
    ).map((r) => r.slug);
    expect(withAudit).toContain("audit-activity");
  });

  it("shows nothing without a reports permission", () => {
    expect(visibleReports(new Set<PermissionCode>(["employee.view_all"]))).toEqual([]);
  });
});

describe("report scope", () => {
  it("defaults to the widest scope the caller holds", () => {
    expect(resolveReportScope(ctx(["reports.view_all"]), headcount)).toBe("all");
    expect(resolveReportScope(ctx(["reports.view_team"]), headcount)).toBe("team");
  });

  it("refuses a company-wide run to a team-only caller", () => {
    expect(() => resolveReportScope(ctx(["reports.view_team"]), headcount, "all")).toThrow(
      ForbiddenError,
    );
  });

  it("lets a company-wide caller narrow to their own team", () => {
    expect(resolveReportScope(ctx(["reports.view_all"]), headcount, "team")).toBe("team");
  });

  it("refuses a team run of a company-only report", () => {
    expect(() =>
      resolveReportScope(ctx(["reports.view_all", "audit.view_all"]), audit, "team"),
    ).toThrow(ForbiddenError);
  });

  it("enforces the report's extra permission", () => {
    expect(() => resolveReportScope(ctx(["reports.view_all"]), audit)).toThrow(ForbiddenError);
    expect(resolveReportScope(ctx(["reports.view_all", "audit.view_all"]), audit)).toBe("all");
  });

  it("refuses a caller with no reports permission at all", () => {
    expect(() => resolveReportScope(ctx(["employee.view_all"]), headcount)).toThrow(ForbiddenError);
  });

  it("filters to direct reports in team scope, and to nobody without an employee record", () => {
    expect(employeeScopeWhere(ctx(["reports.view_all"]), "all")).toEqual({});
    expect(employeeScopeWhere(ctx(["reports.view_team"]), "team")).toEqual({ managerId: "emp-1" });
    expect(employeeScopeWhere(ctx(["reports.view_team"], null), "team")).toEqual({
      managerId: "00000000-0000-0000-0000-000000000000",
    });
  });
});

describe("presence rate", () => {
  const tally = (parts: Partial<ReturnType<typeof blankTally>>) => ({ ...blankTally(), ...parts });

  it("counts a half day as half a day present", () => {
    expect(presenceRate(tally({ present: 1, half_day: 1 }))).toBe(75);
  });

  it("leaves holidays and week-offs out of the denominator", () => {
    expect(presenceRate(tally({ present: 20, holiday: 2, week_off: 8 }))).toBe(100);
  });

  it("counts an approved leave day as a day that was expected", () => {
    expect(presenceRate(tally({ present: 18, on_leave: 2 }))).toBe(90);
  });

  it("is zero rather than NaN for a month with nothing recorded", () => {
    expect(presenceRate(blankTally())).toBe(0);
  });
});
