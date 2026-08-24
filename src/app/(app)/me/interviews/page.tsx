import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { MyInterviews } from "@/components/recruitment/my-interviews";
import { requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "My interviews" };

/**
 * No permission gate: being asked to sit on a round is what entitles somebody
 * to see it, and the endpoint scopes to the caller either way.
 */
export default async function MyInterviewsPage() {
  await requireSession();

  return (
    <>
      <PageHeader
        title="My interviews"
        description="Rounds you have been asked to sit on, and the feedback still waiting on you."
      />
      <MyInterviews />
    </>
  );
}
