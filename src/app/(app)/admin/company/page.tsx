import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader title="Company" description="Organisation profile and regional defaults." />
      <CompanyForm canManage={pageCan(session, "company.manage")} />
    </>
  );
}
