import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { RecruitmentWorkspace } from "@/components/recruitment/recruitment-workspace";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Hiring" };

export default async function RecruitmentPage() {
  const session = await requireSession();
  if (!pageCan(session, "recruitment.view_all"))
    return <NoAccess required="recruitment.view_all" what="hiring" />;

  return (
    <>
      <PageHeader
        title="Hiring"
        description="Roles, the people against them, and the offers that end the conversation."
      />
      <RecruitmentWorkspace canApprove={pageCan(session, "recruitment.approve")} />
    </>
  );
}
