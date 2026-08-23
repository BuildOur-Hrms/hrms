import type { Metadata } from "next";

import { ReportsWorkspace } from "@/components/reports/reports-workspace";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Reports" };

export default async function HrReportsPage() {
  const session = await requireSession();
  if (!pageCan(session, "reports.view_all"))
    return <NoAccess required="reports.view_all" what="company reports" />;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Company-wide answers to the questions HR gets asked. Filters run on the server; the numbers are live."
      />
      <ReportsWorkspace scope="all" />
    </>
  );
}
