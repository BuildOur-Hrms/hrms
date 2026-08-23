import type { Metadata } from "next";

import { LeaveQueue } from "@/components/shared/leave-queue";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { HolidaysPanel } from "./holidays-panel";
import { TypesPanel } from "./types-panel";

export const metadata: Metadata = { title: "Leave" };

export default async function HrLeavePage() {
  const session = await requireSession();

  const canSeeAll = pageCan(session, "leave.view_all");
  const canManageLeave = pageCan(session, "leave.manage");
  const canManageHolidays = pageCan(session, "holidays.manage");

  // Three permissions can open this page for three different reasons, so the
  // gate is "any of them" and each panel decides for itself.
  if (!canSeeAll && !canManageLeave && !canManageHolidays) {
    return <NoAccess required="leave.view_all" what="leave administration" />;
  }

  return (
    <>
      <PageHeader
        title="Leave"
        description="Requests, the holiday calendar, and the policies that price them."
      />
      <div className="space-y-4">
        {pageCan(session, "leave.approve") ? <LeaveQueue scope="all" /> : null}
        {canSeeAll || canManageLeave ? <TypesPanel canManage={canManageLeave} /> : null}
        <HolidaysPanel canManage={canManageHolidays} />
      </div>
    </>
  );
}
