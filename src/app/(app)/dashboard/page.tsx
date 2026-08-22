import type { Metadata } from "next";
import { Building2, CalendarDays, UserCheck, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ButtonLink } from "@/components/shared/button-link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pageCan, requireSession, withPageData } from "@/lib/page";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Phase 1 dashboard.
 *
 * Attendance and leave tiles arrive with M2 and M3; until those tables exist
 * this shows the headcount picture HR actually has today rather than
 * placeholder widgets that pretend to have data.
 */
export default async function DashboardPage() {
  const session = await requireSession();
  const canSeeCompany = pageCan(session, "employee.view_all");
  const canSeeTeam = pageCan(session, "employee.view_team");

  const stats = await withPageData(session, async (db) => {
    if (!canSeeCompany && !canSeeTeam) return null;

    const teamFilter = canSeeCompany
      ? {}
      : { managerId: session.employeeId ?? "00000000-0000-0000-0000-000000000000" };

    const [total, active, onboarding, onNotice, departments] = await Promise.all([
      db.employee.count({ where: teamFilter }),
      db.employee.count({ where: { ...teamFilter, status: "active" } }),
      db.employee.count({ where: { ...teamFilter, status: "onboarding" } }),
      db.employee.count({ where: { ...teamFilter, status: "on_notice" } }),
      canSeeCompany ? db.department.count() : Promise.resolve(0),
    ]);

    return {
      total,
      active,
      onboarding,
      onNotice,
      departments,
      scope: canSeeCompany ? "company" : "team",
    };
  });

  const greeting = session.firstName ? `Welcome back, ${session.firstName}` : "Welcome back";

  return (
    <>
      <PageHeader title={greeting} description={session.company.name} />

      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={stats.scope === "company" ? "Headcount" : "Team size"}
            value={stats.total}
            icon={Users}
          />
          <StatCard label="Active" value={stats.active} icon={UserCheck} />
          <StatCard
            label="Onboarding"
            value={stats.onboarding}
            hint={stats.onNotice > 0 ? `${stats.onNotice} on notice` : undefined}
            icon={CalendarDays}
          />
          {stats.scope === "company" ? (
            <StatCard label="Departments" value={stats.departments} icon={Building2} />
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
            <CardDescription>
              Keep your contact details and emergency contacts current.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ButtonLink href="/me/profile" variant="outline">
              Open my profile
            </ButtonLink>
          </CardContent>
        </Card>

        {pageCan(session, "employee.create") ? (
          <Card>
            <CardHeader>
              <CardTitle>Add someone</CardTitle>
              <CardDescription>
                Create an employee record and send their invite in one step.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ButtonLink href="/hr/employees?new=1">Add employee</ButtonLink>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
