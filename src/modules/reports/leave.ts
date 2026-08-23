import type { RequestContext } from "@/lib/context";
import { currentBalance } from "@/modules/leave/accrual";

import {
  employeeScopeWhere,
  fullName,
  humanize,
  isoDate,
  percent,
  type ReportResult,
  type ReportRow,
  type RunnerArgs,
} from "./runner";
import type { ReportQueryInput, ReportScope } from "./validators";

/**
 * R6 and R7 — the leave reports.
 *
 * Balances are stored as their parts (opening, accrued, used, carried,
 * adjusted) and never as a total, so both reports compute the current figure
 * the same way the leave module does, through `currentBalance`. Two
 * definitions of "how much leave do I have left" is the one thing this report
 * must not introduce.
 */

const DAY_MS = 86_400_000;

/** How many approved requests a calendar month will expand. */
const CALENDAR_REQUEST_CAP = 5_000;

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

// ─────────────────────────────────────────────── R6

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

/**
 * R6 — Leave usage: what each person was given against what they took.
 *
 * One row per employee and leave type, for one leave year. Utilisation is
 * days taken over days made available — entitlement, not the remaining
 * balance, or every fully-spent balance would read as infinite usage.
 */
export async function leaveUsage({ ctx, scope, query }: RunnerArgs): Promise<ReportResult> {
  const year = query.year ?? new Date().getUTCFullYear();

  const where = {
    year,
    ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
    employee: employeeWhere(ctx, scope, query),
  };

  const [balances, total, totals] = await Promise.all([
    ctx.db.leaveBalance.findMany({
      where,
      orderBy: [{ employee: { firstName: "asc" } }, { leaveType: { name: "asc" } }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        opening: true,
        accrued: true,
        used: true,
        carriedForward: true,
        adjusted: true,
        employee: { select: EMPLOYEE_SELECT },
        leaveType: { select: { name: true, isPaid: true } },
      },
    }),
    ctx.db.leaveBalance.count({ where }),
    ctx.db.leaveBalance.aggregate({
      where,
      _sum: { opening: true, accrued: true, used: true, carriedForward: true, adjusted: true },
    }),
  ]);

  const granted =
    toNumber(totals._sum.opening) +
    toNumber(totals._sum.accrued) +
    toNumber(totals._sum.carriedForward) +
    toNumber(totals._sum.adjusted);
  const used = toNumber(totals._sum.used);

  return {
    rows: balances.map((balance) => {
      const parts = {
        opening: toNumber(balance.opening),
        accrued: toNumber(balance.accrued),
        used: toNumber(balance.used),
        carriedForward: toNumber(balance.carriedForward),
        adjusted: toNumber(balance.adjusted),
      };
      return {
        id: balance.id,
        employee: fullName(balance.employee),
        employeeCode: balance.employee.employeeCode,
        department: balance.employee.department?.name ?? null,
        leaveType: balance.leaveType.name,
        opening: parts.opening,
        accrued: parts.accrued,
        carriedForward: parts.carriedForward,
        adjusted: parts.adjusted,
        used: parts.used,
        current: currentBalance(parts),
      };
    }),
    total,
    kpis: [
      { label: "Balances", value: total },
      { label: "Days taken", value: Math.round(used * 10) / 10, format: "days" },
      { label: "Utilisation", value: percent(used, granted), format: "percent" },
    ],
  };
}

// ─────────────────────────────────────────────── R7

/**
 * R7 — Leave calendar: who is away, day by day.
 *
 * Approved requests are expanded into one row per calendar date inside the
 * month. Every date in the span appears, including weekends and holidays
 * falling inside it — the question this answers is "who is not here", which
 * is not the same question as "what were they charged". What they were
 * charged is frozen on the request and lives in R6.
 *
 * Expansion happens in memory because the rows do not exist in any table.
 * A month is bounded work, and the cap below is a guard rail rather than a
 * paging limit: it is reported when it bites instead of quietly truncating.
 */
export async function leaveCalendar({ ctx, scope, query }: RunnerArgs): Promise<ReportResult> {
  const now = new Date();
  const year = query.year ?? now.getUTCFullYear();
  const month = query.month ?? now.getUTCMonth() + 1;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));

  const requests = await ctx.db.leaveRequest.findMany({
    where: {
      status: "approved",
      startDate: { lte: to },
      endDate: { gte: from },
      ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
      employee: employeeWhere(ctx, scope, query),
    },
    orderBy: [{ startDate: "asc" }],
    take: CALENDAR_REQUEST_CAP,
    select: {
      id: true,
      startDate: true,
      endDate: true,
      halfDay: true,
      employee: { select: EMPLOYEE_SELECT },
      leaveType: { select: { name: true } },
    },
  });

  const rows: ReportRow[] = [];
  const peopleOff = new Set<string>();

  for (const request of requests) {
    const start = request.startDate < from ? from : request.startDate;
    const end = request.endDate > to ? to : request.endDate;

    for (let day = start.getTime(); day <= end.getTime(); day += DAY_MS) {
      const date = new Date(day);
      peopleOff.add(request.employee.id);
      rows.push({
        id: `${request.id}:${isoDate(date)}`,
        date: isoDate(date),
        employee: fullName(request.employee),
        employeeCode: request.employee.employeeCode,
        department: request.employee.department?.name ?? null,
        leaveType: request.leaveType.name,
        // A half day only ever applies to a single-date request, so it can be
        // read straight off without asking which end of the span this is.
        halfDay: request.halfDay === "none" ? "" : humanize(request.halfDay),
      });
    }
  }

  rows.sort((a, b) => String(a["date"]).localeCompare(String(b["date"])));

  const start = (query.page - 1) * query.pageSize;
  const kpis = [
    { label: "Days off", value: rows.length },
    { label: "People away", value: peopleOff.size },
  ];
  if (requests.length === CALENDAR_REQUEST_CAP) {
    kpis.push({ label: "Truncated at", value: CALENDAR_REQUEST_CAP });
  }

  return {
    rows: rows.slice(start, start + query.pageSize),
    total: rows.length,
    kpis,
  };
}
