import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { OrgStructure } from "./org-structure";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader
        title="Org structure"
        description="Departments group people; designations describe what they do."
      />
      <OrgStructure
        canManageDepartments={pageCan(session, "department.manage")}
        canManageDesignations={pageCan(session, "designation.manage")}
      />
    </>
  );
}
