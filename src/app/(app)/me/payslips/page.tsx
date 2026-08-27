import type { Metadata } from "next";

import { MyPayslips } from "@/components/payroll/my-payslips";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "My payslips" };

/**
 * No permission gate: `payroll.view_own` is held by every role, and the API
 * scopes to the caller's own record and refuses to answer for anyone else.
 */
export default async function PayslipsPage() {
  await requireSession();

  return (
    <>
      <PageHeader
        title="My payslips"
        description="What you were paid each month, and what made it up."
      />
      <MyPayslips />
    </>
  );
}
