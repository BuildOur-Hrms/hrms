import type { Metadata } from "next";

import { OnboardingWorkspace } from "@/components/checklists/onboarding-workspace";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const session = await requireSession();

  if (!pageCan(session, "onboarding.view_all")) {
    return <NoAccess required="onboarding.view_all" what="onboarding" />;
  }

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Who is arriving, and the checklists they work through."
      />
      <OnboardingWorkspace
        canManage={pageCan(session, "onboarding.manage")}
        // Settled here so overdue means the same thing for everybody looking,
        // whatever their laptop clock says.
        today={new Date().toISOString().slice(0, 10)}
      />
    </>
  );
}
