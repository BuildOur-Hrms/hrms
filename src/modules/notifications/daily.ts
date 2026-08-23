import { notifyOnce, userIdsWithPermission, type DataContext, type NotifyInput } from "./service";

/**
 * The daily notice run (docs/07-workflows-and-automation.md §3): birthdays,
 * work anniversaries, probation endings and tomorrow's holidays.
 *
 * Four notices in one job because they are one question asked of the same
 * table — "what does today mean for each person" — and four crons reading the
 * employee list four times would be three reads and three schedules too many.
 *
 * The job is safe to run twice. Every notice it would write is checked
 * against what is already in the box for that day, so a retry after a partial
 * failure finishes the run instead of duplicating it.
 */

const PROBATION_NOTICE_DAYS = 7;

export interface DailyNoticeResult {
  date: string;
  birthdays: number;
  anniversaries: number;
  probationEnding: number;
  upcomingHolidays: number;
  notifications: number;
}

function monthDay(date: Date): string {
  return date.toISOString().slice(5, 10);
}

function shiftDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function name(employee: { firstName: string; lastName: string | null }): string {
  return [employee.firstName, employee.lastName].filter(Boolean).join(" ");
}

/**
 * Run the day's notices for one company.
 *
 * `today` is the company's own calendar date, resolved by the caller from the
 * company timezone — a job that used the server's date would wish people a
 * happy birthday on the wrong day for half the world.
 */
export async function runDailyNotices(ctx: DataContext, today: string): Promise<DailyNoticeResult> {
  // One read of the roster, four questions asked of it. At pilot scale this is
  // a few hundred rows; filtering in memory keeps the month/day comparisons
  // (which no index can serve anyway) out of SQL.
  const employees = await ctx.db.employee.findMany({
    where: { status: { in: ["active", "onboarding"] } },
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      joinDate: true,
      probationEndDate: true,
      managerId: true,
      locationId: true,
    },
  });

  const hrUserIds = await userIdsWithPermission(ctx, "employee.view_all");
  const byManager = new Map<string, typeof employees>();
  for (const employee of employees) {
    if (!employee.managerId) continue;
    const bucket = byManager.get(employee.managerId) ?? [];
    bucket.push(employee);
    byManager.set(employee.managerId, bucket);
  }
  const userIdOf = new Map(employees.map((e) => [e.id, e.userId]));

  /** The person's manager, and everyone else reporting to that manager. */
  function teammatesOf(employee: (typeof employees)[number]): string[] {
    if (!employee.managerId) return [];
    const managerUser = userIdOf.get(employee.managerId) ?? null;
    const peers = (byManager.get(employee.managerId) ?? [])
      .filter((peer) => peer.id !== employee.id)
      .map((peer) => peer.userId);
    return [managerUser, ...peers].filter((id): id is string => id !== null);
  }

  const notices: NotifyInput[] = [];
  const stamp = monthDay(toDateOnly(today));
  const year = Number(today.slice(0, 4));
  let birthdays = 0;
  let anniversaries = 0;
  let probationEnding = 0;

  for (const employee of employees) {
    if (employee.dateOfBirth && monthDay(employee.dateOfBirth) === stamp) {
      birthdays++;
      // The birth year is deliberately absent from the message. The dashboard
      // widgets show day and month only, and a notification that leaked the
      // year would walk straight around that.
      for (const userId of new Set([...teammatesOf(employee), ...hrUserIds])) {
        if (userId === employee.userId) continue;
        notices.push({
          userId,
          type: "birthday",
          title: `${name(employee)} has a birthday today`,
          body: "Today is their birthday.",
          link: null,
        });
      }
    }

    const years = year - employee.joinDate.getUTCFullYear();
    if (years > 0 && monthDay(employee.joinDate) === stamp) {
      anniversaries++;
      for (const userId of new Set([...teammatesOf(employee), ...hrUserIds])) {
        if (userId === employee.userId) continue;
        notices.push({
          userId,
          type: "work_anniversary",
          title: `${name(employee)} completes ${years} year${years === 1 ? "" : "s"}`,
          body: `Joined on ${employee.joinDate.toISOString().slice(0, 10)}.`,
          link: null,
        });
      }
    }

    if (
      employee.probationEndDate &&
      employee.probationEndDate.toISOString().slice(0, 10) ===
        shiftDays(today, PROBATION_NOTICE_DAYS)
    ) {
      probationEnding++;
      const manager = employee.managerId ? (userIdOf.get(employee.managerId) ?? null) : null;
      for (const userId of new Set([...hrUserIds, ...(manager ? [manager] : [])])) {
        notices.push({
          userId,
          type: "probation.ending",
          title: `${name(employee)} finishes probation in ${PROBATION_NOTICE_DAYS} days`,
          body: "Confirm them, extend the probation, or decide before the date passes.",
          link: `/hr/employees/${employee.id}`,
        });
      }
    }
  }

  // ── tomorrow's holidays, told to the people the holiday applies to.
  const tomorrow = shiftDays(today, 1);
  const holidays = await ctx.db.holiday.findMany({
    where: { holidayDate: toDateOnly(tomorrow) },
    select: { id: true, name: true, locationId: true, isOptional: true },
  });

  for (const holiday of holidays) {
    const audience = employees.filter(
      (employee) => holiday.locationId === null || employee.locationId === holiday.locationId,
    );
    for (const employee of audience) {
      if (!employee.userId) continue;
      notices.push({
        userId: employee.userId,
        type: "holiday.upcoming",
        title: `${holiday.name} is tomorrow`,
        body: holiday.isOptional
          ? "An optional holiday. Apply for it if you plan to take it."
          : "The office is closed.",
        link: "/me/leave",
      });
    }
  }

  const written = await notifyOnce(ctx, toDateOnly(today), notices);

  return {
    date: today,
    birthdays,
    anniversaries,
    probationEnding,
    upcomingHolidays: holidays.length,
    notifications: written,
  };
}
