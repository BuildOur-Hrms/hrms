import type { Metadata } from "next";

import { PerformanceWorkspace } from "@/components/performance/performance-workspace";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Performance" };

export default async function PerformancePage() {
  const session = await requireSession();

  if (!pageCan(session, "performance.view_all")) {
    return <NoAccess required="performance.view_all" what="performance" />;
  }

  return (
    <>
      <PageHeader
        title="Performance"
        description="Review cycles, who has written what, and how the ratings fell."
      />
      <PerformanceWorkspace canManage={pageCan(session, "performance.manage")} />
    </>
  );
}
