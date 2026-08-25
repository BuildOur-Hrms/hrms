import type { Metadata } from "next";

import { MyPerformance } from "@/components/performance/my-performance";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "My performance" };

/**
 * Every employee holds `performance.view_own`, so there is no gate here —
 * what somebody sees is decided by whether a cycle is open, not by a role.
 */
export default async function MyPerformancePage() {
  await requireSession();

  return (
    <>
      <PageHeader
        title="My performance"
        description="What you are working towards this cycle, and your review."
      />
      <MyPerformance />
    </>
  );
}
