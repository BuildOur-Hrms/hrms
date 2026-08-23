import type { Metadata } from "next";

import { pageCan, requireSession } from "@/lib/page";

import { EmployeeDetail } from "./employee-detail";

export const metadata: Metadata = { title: "Employee" };

/**
 * Access is decided by the API, not here: a manager reaching a report's page
 * gets a scoped view, and anyone reaching a record outside their scope gets
 * the not-found state rather than a 403 that would confirm it exists.
 */
export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  return (
    <EmployeeDetail
      id={id}
      canEdit={pageCan(session, "employee.edit")}
      canDelete={pageCan(session, "employee.delete")}
      canInvite={pageCan(session, "users.manage")}
      canManageShifts={pageCan(session, "shifts.manage")}
    />
  );
}
