import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/page";

import { MyLeaveView } from "./leave-view";

export const metadata: Metadata = { title: "My leave" };

/**
 * No permission gate: the API scopes to the caller's own record and refuses
 * to answer for anyone else.
 */
export default async function MyLeavePage() {
  await requireSession();

  return (
    <>
      <PageHeader title="My leave" description="Balances, requests and what each one costs." />
      <MyLeaveView />
    </>
  );
}
