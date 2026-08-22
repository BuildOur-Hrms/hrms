import type { Metadata } from "next";
import { Suspense } from "react";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { EmployeesTable } from "./employees-table";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const session = await requireSession();
  if (!pageCan(session, "employee.view_all"))
    return <NoAccess required="employee.view_all" what="the employee directory" />;

  return (
    <>
      <PageHeader title="Employees" description="Everyone on the payroll, current and past." />
      <Suspense>
        <EmployeesTable canCreate={pageCan(session, "employee.create")} />
      </Suspense>
    </>
  );
}
