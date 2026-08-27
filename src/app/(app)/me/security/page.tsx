import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/page";

import { SecurityView } from "./security-view";

export const metadata: Metadata = { title: "Security" };

/**
 * Deliberately not part of `/me/profile`.
 *
 * That screen is about an employee record, and stops at an empty state when
 * there is not one — which is exactly the case for an administrator account.
 * Changing your own password is a property of the login, not of the person's
 * employment, so it lives where every account can reach it.
 */
export default async function SecurityPage() {
  await requireSession();

  return (
    <>
      <PageHeader title="Security" description="Your password and where you are signed in." />
      <SecurityView />
    </>
  );
}
