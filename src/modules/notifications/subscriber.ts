import { globalSingleton } from "@/lib/global-store";
import { logger } from "@/lib/logger";
import { onAny, type DomainEvent } from "@/lib/events";

import { approverUserIdFor, notify, userIdForEmployee, userIdsWithPermission } from "./service";

/**
 * Turns domain events into notifications.
 *
 * A subscriber rather than calls scattered through each service, for the same
 * reason auditing is one: the leave module should not have to remember to tell
 * somebody, and adding a notification for an event that already exists should
 * not mean editing the code that raises it.
 *
 * Every handler runs inside the emitting request's transaction when there is
 * one, so a notification cannot survive a rolled-back action.
 */

type Handled = Extract<
  DomainEvent["name"],
  | "leave.requested"
  | "leave.reviewed"
  | "attendance.correction_requested"
  | "attendance.correction_reviewed"
  | "shift.assigned"
  | "leave.balance_adjusted"
  | "attendance.month_locked"
>;

function isHandled(name: string): name is Handled {
  return [
    "leave.requested",
    "leave.reviewed",
    "attendance.correction_requested",
    "attendance.correction_reviewed",
    "shift.assigned",
    "leave.balance_adjusted",
    "attendance.month_locked",
  ].includes(name);
}

export function registerNotificationSubscriber(): void {
  const state = globalSingleton("__hrms_notification_subscriber__", () => ({ registered: false }));
  if (state.registered) return;
  state.registered = true;

  onAny(async (event) => {
    if (!isHandled(event.name)) return;

    // Without the emitting transaction there is no tenant scope to write
    // into. Pre-auth flows raise no notifiable events, so this is a guard
    // rather than a case to handle.
    const db = event.actor.db;
    if (!db) return;

    const ctx = { db, companyId: event.actor.companyId };

    try {
      switch (event.name) {
        case "leave.requested": {
          const payload = event.payload as {
            employeeId: string;
            startDate: string;
            endDate: string;
            days: number;
          };
          // The approver is told, not the requester — they already know.
          const approver = await approverUserIdFor(ctx, payload.employeeId);
          if (!approver) return;
          await notify(ctx, [
            {
              userId: approver,
              type: event.name,
              title: "Leave request to review",
              body: `${payload.days} day(s) from ${payload.startDate} to ${payload.endDate}.`,
              link: "/team/leave-approvals",
            },
          ]);
          return;
        }

        case "leave.reviewed": {
          const payload = event.payload as {
            employeeId: string;
            decision: "approved" | "rejected";
            days: number;
          };
          const requester = await userIdForEmployee(ctx, payload.employeeId);
          if (!requester) return;
          await notify(ctx, [
            {
              userId: requester,
              type: event.name,
              title: `Leave ${payload.decision}`,
              body:
                payload.decision === "approved"
                  ? `${payload.days} day(s) came off your balance.`
                  : "Your balance is unchanged.",
              link: "/me/leave",
            },
          ]);
          return;
        }

        case "attendance.correction_requested": {
          const payload = event.payload as { employeeId: string; workDate: string };
          const approver = await approverUserIdFor(ctx, payload.employeeId);
          if (!approver) return;
          await notify(ctx, [
            {
              userId: approver,
              type: event.name,
              title: "Attendance correction to review",
              body: `A correction was requested for ${payload.workDate}.`,
              link: "/team/attendance",
            },
          ]);
          return;
        }

        case "attendance.correction_reviewed": {
          const payload = event.payload as {
            employeeId: string;
            workDate: string;
            decision: "approved" | "rejected";
          };
          const requester = await userIdForEmployee(ctx, payload.employeeId);
          if (!requester) return;
          await notify(ctx, [
            {
              userId: requester,
              type: event.name,
              title: `Correction ${payload.decision}`,
              body: `Your correction for ${payload.workDate} was ${payload.decision}.`,
              link: "/me/attendance",
            },
          ]);
          return;
        }

        case "shift.assigned": {
          const payload = event.payload as { employeeId: string; effectiveFrom: string };
          const employee = await userIdForEmployee(ctx, payload.employeeId);
          if (!employee) return;
          // Their working hours changed, which changes what counts as late.
          await notify(ctx, [
            {
              userId: employee,
              type: event.name,
              title: "Your shift changed",
              body: `A new shift applies from ${payload.effectiveFrom}.`,
              link: "/me/attendance",
            },
          ]);
          return;
        }

        case "leave.balance_adjusted": {
          const payload = event.payload as {
            employeeId: string;
            days: number;
            reason: string;
          };
          const employee = await userIdForEmployee(ctx, payload.employeeId);
          if (!employee) return;
          await notify(ctx, [
            {
              userId: employee,
              type: event.name,
              title: `Leave balance ${payload.days > 0 ? "credited" : "debited"}`,
              body: `${Math.abs(payload.days)} day(s): ${payload.reason}`,
              link: "/me/leave",
            },
          ]);
          return;
        }

        case "attendance.month_locked": {
          const payload = event.payload as {
            year: number;
            month: number;
            action: "locked" | "reopened";
            records: number;
          };
          // Addressed to a role, not a person: everybody who can act on
          // company attendance needs to know the month stopped accepting
          // changes, including whoever did it.
          const hr = await userIdsWithPermission(ctx, "attendance.view_all");
          const month = `${payload.year}-${String(payload.month).padStart(2, "0")}`;
          await notify(
            ctx,
            hr.map((userId) => ({
              userId,
              type: event.name,
              title: `${month} ${payload.action === "locked" ? "locked" : "reopened"}`,
              body:
                payload.action === "locked"
                  ? `${payload.records} record(s) frozen. Punches, corrections and manual entries are now rejected for that month.`
                  : `${payload.records} record(s) unfrozen. That month accepts changes again.`,
              link: "/hr/attendance",
            })),
          );
          return;
        }
      }
    } catch (error) {
      // A notification is a courtesy. Failing to send one must never undo the
      // action that earned it, so this is logged and swallowed.
      logger.error({ event: event.name, err: error }, "could not create notification for event");
    }
  });
}
