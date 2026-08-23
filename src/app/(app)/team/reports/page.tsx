import type { Metadata } from "next";

import { ReportsWorkspace } from "@/components/reports/reports-workspace";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Team reports" };

export default async function TeamReportsPage() {
  const session = await requireSession();
  if (!pageCan(session, "reports.view_team") && !pageCan(session, "reports.view_all"))
    return <NoAccess required="reports.view_team" what="team reports" />;

  return (
    <>
      <PageHeader
        title="Team reports"
        description="The same reports as HR, scoped to your direct reports."
      />
      <ReportsWorkspace scope="team" />
    </>
  );
}
