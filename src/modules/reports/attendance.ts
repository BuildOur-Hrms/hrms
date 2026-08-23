import type { RequestContext } from "@/lib/context";
import { dateToTime } from "@/modules/shifts/validators";

import {
  employeeScopeWhere,
  fullName,
  isoDate,
  percent,
  type ReportResult,
  type RunnerArgs,
} from "./runner";
import type { ReportQueryInput, ReportScope } from "./validators";

/**
 * R2, R3 and R4 — the attendance reports.
 *
 * All three read `attendance_records`, which the nightly job has already
 * reduced from punches. Nothing here recomputes a day: a report that
 * disagreed with the attendance screen would be worse than no report, and the
 * calculator is the one place allowed to decide what a day was.
 *
 * A day with no record is counted as nothing at all. On a month the job has
 * not finished, the totals are short rather than wrong, and the days-recorded
 * KPI is what says so.
 */

const DAY_MS = 86_400_000;

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The month asked for, defaulting to the one we are in. */
function monthRange(query: ReportQueryInput): { from: Date; to: Date } {
  const now = new Date();
  const year = query.year ?? now.getUTCFullYear();
  const month = query.month ?? now.getUTCMonth() + 1;
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 0)) };
}

/** The range asked for, defaulting to the last 30 days ending today. */
function dateRange(query: ReportQueryInput): { from: Date; to: Date } {
  const to = toDateOnly(query.to ?? todayIso());
  const from = query.from ? toDateOnly(query.from) : new Date(to.getTime() - 29 * DAY_MS);
  return { from, to };
}

/**
 * The employee filter as a *nested* relation clause.
 *
 * The tenant extension injects `deleted_at IS NULL` at the top level only, so
 * a nested filter has to say it itself. Without this line a removed employee
 * keeps turning up in every attendance report.
 */
function employeeWhere(
  ctx: RequestContext,
  scope: ReportScope,
  query: ReportQueryInput,
): Record<string, unknown> {
  return {
    deletedAt: null,
    ...employeeScopeWhere(ctx, scope),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.employeeId ? { id: query.employeeId } : {}),
  };
}

const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  department: { select: { name: true } },
} as const;

// ─────────────────────────────────────────────── R2

export interface Tally {
  present: number;
  absent: number;
  half_day: number;
  on_leave: number;
  holiday: number;
  week_off: number;
  workedMinutes: number;
  overtimeMinutes: number;
}

export function blankTally(): Tally {
  return {
    present: 0,
    absent: 0,
    half_day: 0,
    on_leave: 0,
    holiday: 0,
    week_off: 0,
    workedMinutes: 0,
    overtimeMinutes: 0,
  };
}

/**
 * A half day is half present, and a leave day still counts as a day that was
 * expected. Holidays and week-offs are not in the denominator at all.
 */
export function presenceRate(tally: Tally): number {
  const expected = tally.present + tally.absent + tally.half_day + tally.on_leave;
  return percent(tally.present + tally.half_day * 0.5, expected);
}

function hours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/**
 * R2 — Attendance summary: one row per person, one month.
 *
 * Paginated by employee rather than by record, because the row is the person.
 * Presence percentage counts only days that were expected to be worked;
 * holidays and week-offs are not attendance, and folding them in would
 * flatter every number in the report.
 */
export async function attendanceSummary({ ctx, scope, query }: RunnerArgs): Promise<ReportResult> {
  const { from, to } = monthRange(query);
  const employee = employeeWhere(ctx, scope, query);

  const where = {
    ...employee,
    joinDate: { lte: to },
    OR: [{ exitDate: null }, { exitDate: { gte: from } }],
  };

  const [employees, total, overall] = await Promise.all([
    ctx.db.employee.findMany({
      where,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: EMPLOYEE_SELECT,
    }),
    ctx.db.employee.count({ where }),
    // The KPI describes everyone the filters match, not the page in front of
    // you. An average that moved as you paged would mean nothing.
    ctx.db.attendanceRecord.groupBy({
      by: ["status"],
      where: { employee, workDate: { gte: from, lte: to } },
      _count: { _all: true },
    }),
  ]);

  const ids = employees.map((e) => e.id);
  const grouped = ids.length
    ? await ctx.db.attendanceRecord.groupBy({
        by: ["employeeId", "status"],
        where: { employeeId: { in: ids }, workDate: { gte: from, lte: to } },
        _count: { _all: true },
        _sum: { workedMinutes: true, overtimeMinutes: true },
      })
    : [];

  const perEmployee = new Map<string, Tally>();
  for (const row of grouped) {
    const tally = perEmployee.get(row.employeeId) ?? blankTally();
    tally[row.status] = row._count._all;
    tally.workedMinutes += row._sum.workedMinutes ?? 0;
    tally.overtimeMinutes += row._sum.overtimeMinutes ?? 0;
    perEmployee.set(row.employeeId, tally);
  }

  const counts = Object.fromEntries(overall.map((r) => [r.status, r._count._all]));
  const company = blankTally();
  company.present = counts["present"] ?? 0;
  company.absent = counts["absent"] ?? 0;
  company.half_day = counts["half_day"] ?? 0;
  company.on_leave = counts["on_leave"] ?? 0;

  return {
    rows: employees.map((row) => {
      const tally = perEmployee.get(row.id) ?? blankTally();
      return {
        id: row.id,
        employee: fullName(row),
        employeeCode: row.employeeCode,
        department: row.department?.name ?? null,
        present: tally.present,
        absent: tally.absent,
        halfDay: tally.half_day,
        onLeave: tally.on_leave,
        holiday: tally.holiday,
        weekOff: tally.week_off,
        workedHours: hours(tally.workedMinutes),
        overtimeHours: hours(tally.overtimeMinutes),
        presencePercent: presenceRate(tally),
      };
    }),
    total,
    kpis: [
      { label: "People", value: total },
      { label: "Avg presence", value: presenceRate(company), format: "percent" },
      { label: "Days recorded", value: overall.reduce((sum, r) => sum + r._count._all, 0) },
    ],
  };
}

// ─────────────────────────────────────────────── shifts, in bulk

type ShiftLite = { id: string; name: string; startTime: Date };

/**
 * Resolve "which shift was this person on that day" for a whole page at once.
 *
 * `effectiveShift` answers it for one employee on one date, which is a query
 * per row: fine on a profile, ruinous on a report of a thousand days. The
 * rule applied here is the same one it applies.
 */
async function shiftLookup(
  ctx: RequestContext,
  employeeIds: string[],
  from: Date,
  to: Date,
): Promise<(employeeId: string, on: Date) => ShiftLite | null> {
  const select = { id: true, name: true, startTime: true } as const;

  const [assignments, fallback] = await Promise.all([
    employeeIds.length
      ? ctx.db.employeeShift.findMany({
          where: {
            employeeId: { in: employeeIds },
            effectiveFrom: { lte: to },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
          },
          orderBy: { effectiveFrom: "desc" },
          select: { employeeId: true, effectiveFrom: true, effectiveTo: true, shift: { select } },
        })
      : Promise.resolve([]),
    ctx.db.shift.findFirst({ where: { isDefault: true }, select }),
  ]);

  const byEmployee = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const bucket = byEmployee.get(assignment.employeeId) ?? [];
    bucket.push(assignment);
    byEmployee.set(assignment.employeeId, bucket);
  }

  return (employeeId, on) => {
    // Newest first, so the first range containing the date is the one in force.
    for (const assignment of byEmployee.get(employeeId) ?? []) {
      if (assignment.effectiveFrom > on) continue;
      if (assignment.effectiveTo && assignment.effectiveTo < on) continue;
      return assignment.shift;
    }
    return fallback;
  };
}

// ─────────────────────────────────────────────── R3

/**
 * R3 — Absences: days marked absent, with the shift the person was expected
 * on.
 *
 * Approved leave is `on_leave`, never `absent`, so it cannot appear here.
 * That is precisely what makes the list worth acting on: every row is a day
 * nobody has explained.
 */
export async function absences({ ctx, scope, query }: RunnerArgs): Promise<ReportResult> {
  const { from, to } = dateRange(query);
  const where = {
    status: "absent" as const,
    workDate: { gte: from, lte: to },
    employee: employeeWhere(ctx, scope, query),
  };

  const [records, total, topAbsentees] = await Promise.all([
    ctx.db.attendanceRecord.findMany({
      where,
      orderBy: [{ workDate: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: { id: true, workDate: true, employee: { select: EMPLOYEE_SELECT } },
    }),
    ctx.db.attendanceRecord.count({ where }),
    ctx.db.attendanceRecord.groupBy({
      by: ["employeeId"],
      where,
      _count: { _all: true },
      orderBy: { _count: { employeeId: "desc" } },
      take: 5,
    }),
  ]);

  const [shiftOn, names] = await Promise.all([
    shiftLookup(
      ctx,
      records.map((r) => r.employee.id),
      from,
      to,
    ),
    ctx.db.employee.findMany({
      where: { id: { in: topAbsentees.map((t) => t.employeeId) } },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const nameById = new Map(names.map((n) => [n.id, fullName(n)]));

  return {
    rows: records.map((record) => {
      const shift = shiftOn(record.employee.id, record.workDate);
      return {
        id: record.id,
        employee: fullName(record.employee),
        employeeCode: record.employee.employeeCode,
        department: record.employee.department?.name ?? null,
        date: isoDate(record.workDate),
        shift: shift?.name ?? null,
        shiftStart: shift ? dateToTime(shift.startTime) : null,
      };
    }),
    total,
    kpis: [{ label: "Absences", value: total }],
    breakdown: topAbsentees.map((row) => ({
      label: nameById.get(row.employeeId) ?? "Unknown",
      count: row._count._all,
    })),
  };
}

// ─────────────────────────────────────────────── R4

/**
 * R4 — Late arrivals.
 *
 * `lateMinutes` is already net of the shift grace period, so the threshold
 * here sits on top of it: grace decides what counts as late, the threshold
 * decides what is worth looking at.
 */
export async function lateArrivals({ ctx, scope, query }: RunnerArgs): Promise<ReportResult> {
  const { from, to } = dateRange(query);
  const threshold = query.lateThresholdMinutes ?? 1;

  const employee = employeeWhere(ctx, scope, query);
  const where = {
    workDate: { gte: from, lte: to },
    lateMinutes: { gte: threshold },
    employee,
  };

  const [records, total, aggregate, workedDays] = await Promise.all([
    ctx.db.attendanceRecord.findMany({
      where,
      orderBy: [{ workDate: "desc" }, { lateMinutes: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        workDate: true,
        firstIn: true,
        lateMinutes: true,
        employee: { select: EMPLOYEE_SELECT },
      },
    }),
    ctx.db.attendanceRecord.count({ where }),
    ctx.db.attendanceRecord.aggregate({ where, _avg: { lateMinutes: true } }),
    // The denominator for the rate: only a day someone worked can be arrived
    // at late. Week-offs and holidays are not opportunities to be punctual.
    ctx.db.attendanceRecord.count({
      where: {
        workDate: { gte: from, lte: to },
        status: { in: ["present", "half_day"] },
        employee,
      },
    }),
  ]);

  const shiftOn = await shiftLookup(
    ctx,
    records.map((r) => r.employee.id),
    from,
    to,
  );

  return {
    rows: records.map((record) => {
      const shift = shiftOn(record.employee.id, record.workDate);
      return {
        id: record.id,
        employee: fullName(record.employee),
        employeeCode: record.employee.employeeCode,
        department: record.employee.department?.name ?? null,
        date: isoDate(record.workDate),
        shiftStart: shift ? dateToTime(shift.startTime) : null,
        checkIn: record.firstIn?.toISOString() ?? null,
        lateMinutes: record.lateMinutes,
      };
    }),
    total,
    kpis: [
      { label: "Late arrivals", value: total },
      { label: "Late rate", value: percent(total, workedDays), format: "percent" },
      { label: "Avg late", value: Math.round(aggregate._avg.lateMinutes ?? 0), format: "minutes" },
    ],
  };
}
