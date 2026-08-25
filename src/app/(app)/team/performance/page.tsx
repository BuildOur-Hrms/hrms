import type { Metadata } from "next";

import { TeamPerformance } from "@/components/performance/team-performance";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Team performance" };

export default async function TeamPerformancePage() {
  const session = await requireSession();

  if (!pageCan(session, "performance.view_team")) {
    return <NoAccess required="performance.view_team" what="your team's reviews" />;
  }

  return (
    <>
      <PageHeader
        title="Team performance"
        description="The reviews you owe, and the goals your reports have set."
      />
      <TeamPerformance />
    </>
  );
}
