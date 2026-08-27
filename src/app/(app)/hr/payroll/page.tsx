import type { Metadata } from "next";

import { PayrollWorkspace } from "@/components/payroll/payroll-workspace";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const session = await requireSession();

  if (!pageCan(session, "payroll.view_all")) {
    return <NoAccess required="payroll.view_all" what="payroll" />;
  }

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Work out a month, approve it, and hand the totals to finance."
      />
      <PayrollWorkspace
        canManage={pageCan(session, "payroll.manage")}
        canApprove={pageCan(session, "payroll.approve")}
      />
    </>
  );
}
