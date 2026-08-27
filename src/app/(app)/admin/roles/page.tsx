import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { RolesView } from "./roles-view";

export const metadata: Metadata = { title: "Roles" };

export default async function RolesPage() {
  const session = await requireSession();
  if (!pageCan(session, "roles.view_all"))
    return <NoAccess required="roles.view_all" what="roles and permissions" />;

  return (
    <>
      <PageHeader
        title="Roles and permissions"
        description="What each role is allowed to do, as the system actually evaluates it."
      />
      <RolesView
        canManage={pageCan(session, "roles.manage")}
        /*
         * The caller's own permissions, which are the ones they may put in a
         * role. Sent so the screen can grey out the rest: the server refuses
         * them regardless, and finding that out by being told no is a worse
         * way to learn the rule.
         */
        grantable={[...session.permissions]}
      />
    </>
  );
}
