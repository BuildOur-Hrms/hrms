import type { Metadata } from "next";
import { CalendarCheck, CalendarDays, Clock, FileClock } from "lucide-react";

import { ButtonLink } from "@/components/shared/button-link";
import { PanelTile } from "@/components/shared/panel-tile";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession, withPageData } from "@/lib/page";
import { employeeHome } from "@/modules/dashboard/service";

export const metadata: Metadata = { title: "My space" };

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  on_leave: "On leave",
  holiday: "Holiday",
  week_off: "Week off",
};

function humanMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * The employee panel home.
 *
 * Answers the four questions somebody actually opens this app to ask: am I
 * clocked in, how much leave do I have, what is waiting on someone else, and
 * when is the next day off.
 */
export default async function MySpacePage() {
  const session = await requireSession();

  const data = session.employeeId
    ? await withPageData(session, (db) =>
        employeeHome({ db, companyId: session.companyId }, session.employeeId!),
      )
    : null;

  const greeting = session.firstName ? `Hello, ${session.firstName}` : "My space";

  if (!data) {
    // A user account with no employee record — rare, but it should say so
    // rather than render four empty tiles.
    return (
      <>
        <PageHeader title={greeting} />
        <Card>
          <CardHeader>
            <CardTitle>No employee record</CardTitle>
            <CardDescription>
              This account is not linked to an employee, so there is no attendance or leave to show.
              An HR admin can link it.
            </CardDescription>
          </CardHeader>
        </Card>
      </>
    );
  }

  const totalLeave = data.balances.reduce((sum, b) => sum + b.current, 0);

  return (
    <>
      <PageHeader title={greeting} description={session.company.name} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PanelTile
          label="Today"
          value={data.today ? (STATUS_LABEL[data.today.status] ?? data.today.status) : "—"}
          hint={
            data.today
              ? data.today.checkedIn
                ? "Checked in now"
                : humanMinutes(data.today.workedMinutes)
              : "Not calculated yet"
          }
          href="/me/attendance"
          icon={Clock}
        />
        <PanelTile
          label="Leave left"
          value={totalLeave}
          hint={`${data.balances.length} type${data.balances.length === 1 ? "" : "s"}`}
          href="/me/leave"
          icon={CalendarCheck}
        />
        <PanelTile
          label="Leave pending"
          value={data.pendingLeave}
          hint="Waiting on your manager"
          href="/me/leave"
          icon={CalendarDays}
          tone="attention"
        />
        <PanelTile
          label="Corrections pending"
          value={data.pendingCorrections}
          hint="Waiting on your manager"
          href="/me/attendance"
          icon={FileClock}
          tone="attention"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leave balances</CardTitle>
            <CardDescription>For {new Date().getUTCFullYear()}.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.balances.length === 0 ? (
              <p className="text-muted-foreground text-sm">No leave types have been set up yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.balances.map((b) => (
                  <li key={b.leaveType.id} className="flex items-center gap-2 text-sm">
                    {b.leaveType.color ? (
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: b.leaveType.color }}
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{b.leaveType.name}</span>
                    <span className="font-semibold tabular-nums">{b.current}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <ButtonLink href="/me/leave" variant="outline" size="sm">
                Apply for leave
              </ButtonLink>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
            <CardDescription>The next holidays on your calendar.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.upcomingHolidays.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No holidays are on the calendar ahead of today.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.upcomingHolidays.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground w-24 shrink-0 tabular-nums">
                      {h.holidayDate}
                    </span>
                    <span className="min-w-0 truncate">{h.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
