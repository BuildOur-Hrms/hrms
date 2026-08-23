import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { ShiftsView } from "./shifts-view";

export const metadata: Metadata = { title: "Shifts" };

export default async function ShiftsPage() {
  const session = await requireSession();

  if (!pageCan(session, "shifts.manage")) {
    return <NoAccess required="shifts.manage" what="shift settings" />;
  }

  return (
    <>
      <PageHeader
        title="Shifts"
        description="Working-time rules. Attendance is measured against whichever shift an employee is on for that date."
      />
      <ShiftsView canManage={pageCan(session, "shifts.manage")} />
    </>
  );
}
