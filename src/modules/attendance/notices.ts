import { notifyOnce, type DataContext, type NotifyInput } from "@/modules/notifications/service";

/**
 * The notices the nightly calculation produces (docs/07-workflows-and-automation.md §3):
 * `attendance.late`, `attendance.absent_no_leave` and
 * `attendance.missing_checkout`.
 *
 * They are written from the finished records rather than from inside the
 * calculator, on purpose. The calculator is a pure function over punches and
 * has to stay that way to remain testable; deciding who to tell is a separate
 * question asked once the day is settled.
 *
 * Reading the day back also means a manual recompute produces the same
 * notices as the cron, with no second code path to keep in step.
 */

const MISSING_CHECKOUT = "attendance.missing_checkout";

export interface AttendanceNoticeResult {
  workDate: string;
  late: number;
  absent: number;
  missingCheckout: number;
  notifications: number;
}

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Notify on one settled day.
 *
 * `since` bounds the duplicate check — the run's own date, which is the day
 * after `workDate` for the nightly job. Passing it in rather than deriving it
 * keeps this correct when HR recomputes an old day by hand.
 */
export async function sendAttendanceNotices(
  ctx: DataContext,
  workDate: string,
  since: Date,
): Promise<AttendanceNoticeResult> {
  const records = await ctx.db.attendanceRecord.findMany({
    where: { workDate: toDateOnly(workDate) },
    select: {
      status: true,
      lateMinutes: true,
      firstIn: true,
      lastOut: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          userId: true,
          manager: { select: { userId: true } },
        },
      },
    },
  });

  const notices: NotifyInput[] = [];
  let late = 0;
  let absent = 0;
  let missingCheckout = 0;

  for (const record of records) {
    const self = record.employee.userId;
    const manager = record.employee.manager?.userId ?? null;
    const who = [record.employee.firstName, record.employee.lastName].filter(Boolean).join(" ");

    if (record.lateMinutes > 0 && (record.status === "present" || record.status === "half_day")) {
      late++;
      if (self) {
        notices.push({
          userId: self,
          type: "attendance.late",
          title: `Late on ${workDate}`,
          body: `You checked in ${record.lateMinutes} minute(s) after your shift started.`,
          link: "/me/attendance",
        });
      }
      if (manager) {
        notices.push({
          userId: manager,
          type: "attendance.late",
          title: `${who} was late on ${workDate}`,
          body: `${record.lateMinutes} minute(s) after their shift started.`,
          link: "/team/attendance",
        });
      }
    }

    // `absent` already means no approved leave — a day covered by leave is
    // `on_leave`, and the calculator never conflates the two.
    if (record.status === "absent") {
      absent++;
      if (self) {
        notices.push({
          userId: self,
          type: "attendance.absent_no_leave",
          title: `Marked absent on ${workDate}`,
          body: "No punches and no approved leave. Raise a correction if that is wrong.",
          link: "/me/attendance",
        });
      }
      if (manager) {
        notices.push({
          userId: manager,
          type: "attendance.absent_no_leave",
          title: `${who} was absent on ${workDate}`,
          body: "No punches and no approved leave for the day.",
          link: "/team/attendance",
        });
      }
    }

    // Only the person who forgot can say what time they left, so this one
    // goes to them alone.
    if (record.firstIn && !record.lastOut) {
      missingCheckout++;
      if (self) {
        notices.push({
          userId: self,
          type: MISSING_CHECKOUT,
          title: `No check-out on ${workDate}`,
          body: "The day cannot be counted until it has an end time. Raise a correction.",
          link: "/me/attendance",
        });
      }
    }
  }

  const notifications = await notifyOnce(ctx, since, notices);
  return { workDate, late, absent, missingCheckout, notifications };
}
