import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requirePagePermission, requireSession } from "@/lib/page";

import { EmployeesTable } from "./employees-table";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const session = await requireSession();
  requirePagePermission(session, "employee.view_all");

  return (
    <>
      <PageHeader title="Employees" description="Everyone on the payroll, current and past." />
      <Suspense>
        <EmployeesTable canCreate={pageCan(session, "employee.create")} />
      </Suspense>
    </>
  );
}
