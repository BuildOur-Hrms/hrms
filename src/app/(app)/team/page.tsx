import type { Metadata } from "next";
import { Users } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { EmployeeStatusBadge, employmentTypeLabel } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { pageCan, requireSession, withPageData } from "@/lib/page";
import { fullName, initials, toDateOnly } from "@/lib/utils";

export const metadata: Metadata = { title: "My team" };

/**
 * A manager's direct reports.
 *
 * Rendered on the server from the session's tenant transaction rather than
 * through the API, because there is no interaction here — just a read that
 * should already be complete when the page paints.
 */
export default async function TeamPage() {
  const session = await requireSession();
  if (!pageCan(session, "employee.view_team"))
    return <NoAccess required="employee.view_team" what="team data" />;

  const reports = session.employeeId
    ? await withPageData(session, (db) =>
        db.employee.findMany({
          where: { managerId: session.employeeId!, status: { not: "exited" } },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            workEmail: true,
            status: true,
            employmentType: true,
            joinDate: true,
            designation: { select: { title: true } },
            location: { select: { name: true } },
          },
        }),
      )
    : [];

  return (
    <>
      <PageHeader
        title="My team"
        description={
          reports.length > 0
            ? `${reports.length} direct report${reports.length === 1 ? "" : "s"}`
            : undefined
        }
      />

      {reports.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No direct reports"
          description="People whose manager is set to you will appear here. Ask HR to update reporting lines if this looks wrong."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => (
            <Card key={report.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <Avatar className="size-10 shrink-0">
                  <AvatarFallback>{initials(report.firstName, report.lastName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/hr/employees/${report.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {fullName(report.firstName, report.lastName)}
                  </Link>
                  <p className="text-muted-foreground truncate text-sm">
                    {report.designation?.title ?? "No designation"}
                  </p>
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    {report.workEmail ?? report.employeeCode} ·{" "}
                    {employmentTypeLabel(report.employmentType)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Joined {toDateOnly(report.joinDate)}
                  </p>
                  <div className="mt-2">
                    <EmployeeStatusBadge status={report.status} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
