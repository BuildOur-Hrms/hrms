import type { Metadata } from "next";
import { AlertTriangle, CalendarDays, Clock, UserPlus, Users } from "lucide-react";

import { ButtonLink } from "@/components/shared/button-link";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { PanelTile } from "@/components/shared/panel-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pageCan, requireSession, withPageData } from "@/lib/page";
import { hrHome } from "@/modules/dashboard/service";

export const metadata: Metadata = { title: "HR" };

/**
 * The HR panel home.
 *
 * Two questions: what does the company look like today, and what is sitting
 * in somebody's queue. Everything else on this panel is a screen away.
 */
export default async function HrHomePage() {
  const session = await requireSession();

  if (!pageCan(session, "employee.view_all")) {
    return <NoAccess required="employee.view_all" what="the HR panel" />;
  }

  const data = await withPageData(session, (db) => hrHome({ db, companyId: session.companyId }));

  return (
    <>
      <PageHeader
        title="HR"
        description={`${session.company.name} — today at a glance, and what needs a decision.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PanelTile
          label="Headcount"
          value={data.headcount}
          hint={`${data.active} active`}
          href="/hr/employees"
          icon={Users}
        />
        <PanelTile
          label="Onboarding"
          value={data.onboarding}
          hint={data.onNotice > 0 ? `${data.onNotice} on notice` : "Nobody on notice"}
          href="/hr/employees"
          icon={UserPlus}
        />
        <PanelTile
          label="Leave to review"
          value={data.queues.leave}
          hint="Pending a decision"
          href="/hr/leave"
          icon={CalendarDays}
          tone="attention"
        />
        <PanelTile
          label="Corrections to review"
          value={data.queues.corrections}
          hint="Pending a decision"
          href="/hr/attendance"
          icon={Clock}
          tone="attention"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>
              {data.today.calculated === 0
                ? // Zero calculated is not the same as everybody being absent,
                  // and saying so avoids a daily false alarm.
                  "No attendance has been calculated for today yet. The nightly job runs after the day ends."
                : `${data.today.calculated} employee-day${data.today.calculated === 1 ? "" : "s"} calculated.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Figure label="Present" value={data.today.present} />
              <Figure label="Absent" value={data.today.absent} />
              <Figure label="Half day" value={data.today.halfDay} />
              <Figure label="On leave" value={data.today.onLeave} />
              <Figure label="Week off" value={data.today.weekOff} />
              <Figure label="Holiday" value={data.today.holiday} />
            </dl>

            {data.today.needsReview > 0 ? (
              <p className="text-warning mt-4 flex items-center gap-1.5 text-sm">
                <AlertTriangle className="size-4" />
                {data.today.needsReview} day{data.today.needsReview === 1 ? "" : "s"} need review
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <ButtonLink href="/hr/attendance" variant="outline" size="sm">
                Open attendance
              </ButtonLink>
              {pageCan(session, "employee.create") ? (
                <ButtonLink href="/hr/employees?new=1" size="sm">
                  Add employee
                </ButtonLink>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
            <CardDescription>The next holidays on the calendar.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.upcomingHolidays.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing ahead. Without a calendar, every public holiday is charged as a working day.
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
            <div className="mt-4">
              <ButtonLink href="/hr/leave" variant="outline" size="sm">
                Manage calendar
              </ButtonLink>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
