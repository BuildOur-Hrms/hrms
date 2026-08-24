import type { Metadata } from "next";

import { OffboardingWorkspace } from "@/components/checklists/offboarding-workspace";
import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Offboarding" };

export default async function OffboardingPage() {
  const session = await requireSession();

  if (!pageCan(session, "offboarding.view_all")) {
    return <NoAccess required="offboarding.view_all" what="offboarding" />;
  }

  return (
    <>
      <PageHeader
        title="Offboarding"
        description="Who is leaving, and the checklists they work through on the way out."
      />
      <OffboardingWorkspace canManage={pageCan(session, "offboarding.manage")} />
    </>
  );
}
