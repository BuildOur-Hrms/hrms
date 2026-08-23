import type { RequestContext } from "@/lib/context";

import { currentBalance } from "@/modules/leave/accrual";

/**
 * The three panel homes: what an employee, an HR admin and a platform admin
 * each need to see first.
 *
 * These read through the page's own tenant transaction rather than going out
 * to the API, because there is no interaction on a landing page — the numbers
 * should already be there when it paints.
 *
 * Every function takes only a database handle and a company, so none of them
 * can accidentally reach for a permission it has not been given. The page
 * decides who may call which.
 */

export type DataContext = Pick<RequestContext, "db" | "companyId">;

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────── employee

/** Everything the self-service home shows. */
export async function employeeHome(ctx: DataContext, employeeId: string) {
  const now = today();
  const year = Number(now.slice(0, 4));

  const [record, balances, holidays, pendingLeave, pendingCorrections] = await Promise.all([
    ctx.db.attendanceRecord.findFirst({
      where: { employeeId, workDate: toDateOnly(now) },
      select: { status: true, workedMinutes: true, firstIn: true, lastOut: true },
    }),
    ctx.db.leaveBalance.findMany({
      where: { employeeId, year },
      select: {
        opening: true,
        accrued: true,
        used: true,
        carriedForward: true,
        adjusted: true,
        leaveType: { select: { id: true, name: true, code: true, color: true } },
      },
    }),
    // The next few, not the whole year — a landing page answers "what is
    // coming", and the full calendar lives on the leave screen.
    ctx.db.holiday.findMany({
      where: { holidayDate: { gte: toDateOnly(now) } },
      orderBy: { holidayDate: "asc" },
      take: 3,
      select: { id: true, name: true, holidayDate: true },
    }),
    ctx.db.leaveRequest.count({ where: { employeeId, status: "pending" } }),
    ctx.db.attendanceCorrection.count({ where: { employeeId, status: "pending" } }),
  ]);

  return {
    today: record
      ? {
          status: record.status,
          workedMinutes: record.workedMinutes,
          checkedIn: record.firstIn !== null && record.lastOut === null,
        }
      : null,
    balances: balances.map((b) => ({
      leaveType: b.leaveType,
      current: currentBalance({
        opening: Number(b.opening),
        accrued: Number(b.accrued),
        used: Number(b.used),
        carriedForward: Number(b.carriedForward),
        adjusted: Number(b.adjusted),
      }),
    })),
    upcomingHolidays: holidays.map((h) => ({
      id: h.id,
      name: h.name,
      holidayDate: isoDate(h.holidayDate),
    })),
    pendingLeave,
    pendingCorrections,
  };
}

// ─────────────────────────────────────────────── HR

/** The HR home: today's shape of the company, and what is waiting on someone. */
export async function hrHome(ctx: DataContext) {
  const now = today();

  const [
    headcount,
    active,
    onboarding,
    onNotice,
    byStatus,
    needsReview,
    leaveQueue,
    correctionQueue,
    holidays,
  ] = await Promise.all([
    ctx.db.employee.count(),
    ctx.db.employee.count({ where: { status: "active" } }),
    ctx.db.employee.count({ where: { status: "onboarding" } }),
    ctx.db.employee.count({ where: { status: "on_notice" } }),
    ctx.db.attendanceRecord.groupBy({
      by: ["status"],
      where: { workDate: toDateOnly(now) },
      _count: { _all: true },
    }),
    ctx.db.attendanceRecord.count({ where: { workDate: toDateOnly(now), needsReview: true } }),
    ctx.db.leaveRequest.count({ where: { status: "pending" } }),
    ctx.db.attendanceCorrection.count({ where: { status: "pending" } }),
    ctx.db.holiday.findMany({
      where: { holidayDate: { gte: toDateOnly(now) } },
      orderBy: { holidayDate: "asc" },
      take: 3,
      select: { id: true, name: true, holidayDate: true },
    }),
  ]);

  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));

  return {
    headcount,
    active,
    onboarding,
    onNotice,
    today: {
      present: counts["present"] ?? 0,
      absent: counts["absent"] ?? 0,
      halfDay: counts["half_day"] ?? 0,
      onLeave: counts["on_leave"] ?? 0,
      weekOff: counts["week_off"] ?? 0,
      holiday: counts["holiday"] ?? 0,
      // Zero here on a day the nightly job has not run is not the same as
      // everyone being present, and the screen says so.
      calculated: byStatus.reduce((total, r) => total + r._count._all, 0),
      needsReview,
    },
    queues: { leave: leaveQueue, corrections: correctionQueue },
    upcomingHolidays: holidays.map((h) => ({
      id: h.id,
      name: h.name,
      holidayDate: isoDate(h.holidayDate),
    })),
  };
}

// ─────────────────────────────────────────────── admin

export interface SetupItem {
  key: string;
  label: string;
  done: boolean;
  detail: string;
  href: string;
}

/**
 * The admin home: accounts, and whether the company is actually configured.
 *
 * The checklist is the useful part. Every item on it is something that is
 * silently fine until the day it is not — no default shift means attendance
 * cannot be measured, no leave type means nobody can apply, an empty holiday
 * calendar means every public holiday is charged as a working day.
 */
export async function adminHome(ctx: DataContext) {
  const year = new Date().getUTCFullYear();

  const [
    users,
    roles,
    defaultShift,
    shifts,
    leaveTypes,
    policies,
    holidays,
    locations,
    recentAudit,
  ] = await Promise.all([
    ctx.db.user.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.db.role.count(),
    ctx.db.shift.count({ where: { isDefault: true } }),
    ctx.db.shift.count(),
    ctx.db.leaveType.count(),
    ctx.db.leavePolicy.count(),
    ctx.db.holiday.count({
      where: {
        holidayDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    }),
    ctx.db.location.count(),
    ctx.db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
        actor: { select: { email: true } },
      },
    }),
  ]);

  const userCounts = Object.fromEntries(users.map((r) => [r.status, r._count._all]));

  const setup: SetupItem[] = [
    {
      key: "locations",
      label: "At least one location",
      done: locations > 0,
      detail: `${locations} configured`,
      href: "/admin/locations",
    },
    {
      key: "default-shift",
      label: "A default shift",
      done: defaultShift > 0,
      detail:
        defaultShift > 0
          ? `${shifts} shift${shifts === 1 ? "" : "s"}, one of them default`
          : "Attendance cannot be measured without one",
      href: "/hr/shifts",
    },
    {
      key: "leave-types",
      label: "Leave types",
      done: leaveTypes > 0,
      detail:
        leaveTypes > 0
          ? `${leaveTypes} type${leaveTypes === 1 ? "" : "s"}, ${policies} with a policy`
          : "Nobody can apply for leave until one exists",
      href: "/hr/leave",
    },
    {
      key: "holidays",
      label: `Holiday calendar for ${year}`,
      done: holidays > 0,
      detail:
        holidays > 0
          ? `${holidays} holiday${holidays === 1 ? "" : "s"}`
          : "Every public holiday will be charged as a working day",
      href: "/hr/leave",
    },
  ];

  return {
    users: {
      active: userCounts["active"] ?? 0,
      invited: userCounts["invited"] ?? 0,
      disabled: userCounts["disabled"] ?? 0,
    },
    roles,
    setup,
    recentAudit: recentAudit.map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      at: a.createdAt.toISOString(),
      actor: a.actor?.email ?? "system",
    })),
  };
}
