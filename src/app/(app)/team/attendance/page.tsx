import type { Metadata } from "next";

import { AttendanceDayGrid } from "@/components/shared/attendance-day-grid";
import { CorrectionQueue } from "@/components/shared/correction-queue";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Team attendance" };

export default async function TeamAttendancePage() {
  const session = await requireSession();

  if (!pageCan(session, "attendance.view_team")) {
    return <NoAccess required="attendance.view_team" what="team attendance" />;
  }

  return (
    <>
      <PageHeader
        title="Team attendance"
        description="Who is in today, and what needs a decision from you."
      />
      <div className="space-y-4">
        {pageCan(session, "attendance.approve") ? <CorrectionQueue /> : null}
        <AttendanceDayGrid scope="team" />
      </div>
    </>
  );
}
