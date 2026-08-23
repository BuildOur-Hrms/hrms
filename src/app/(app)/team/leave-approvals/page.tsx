import type { Metadata } from "next";

import { LeaveQueue } from "@/components/shared/leave-queue";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Leave approvals" };

export default async function TeamLeaveApprovalsPage() {
  const session = await requireSession();

  if (!pageCan(session, "leave.approve")) {
    return <NoAccess required="leave.approve" what="leave approvals" />;
  }

  return (
    <>
      <PageHeader
        title="Leave approvals"
        description="Requests from your team that need a decision."
      />
      <LeaveQueue scope="team" />
    </>
  );
}
