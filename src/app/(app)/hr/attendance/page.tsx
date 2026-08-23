import type { Metadata } from "next";

import { AttendanceDayGrid } from "@/components/shared/attendance-day-grid";
import { CorrectionQueue } from "@/components/shared/correction-queue";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { MonthLocks } from "./month-locks";

export const metadata: Metadata = { title: "Attendance" };

export default async function HrAttendancePage() {
  const session = await requireSession();

  if (!pageCan(session, "attendance.view_all")) {
    return <NoAccess required="attendance.view_all" what="company attendance" />;
  }

  return (
    <>
      <PageHeader
        title="Attendance"
        description="The whole company, day by day, the payroll freeze, and days entered by hand."
      />
      <div className="space-y-4">
        <MonthLocks canManage={pageCan(session, "attendance.manage")} />
        {pageCan(session, "attendance.approve") ? <CorrectionQueue /> : null}
        <AttendanceDayGrid scope="all" canEnterManually={pageCan(session, "attendance.edit")} />
      </div>
    </>
  );
}
