import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  if (!pageCan(session, "settings.manage"))
    return <NoAccess required="settings.manage" what="settings" />;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Company configuration. Keys marked Platform are edited by a super admin."
      />
      <SettingsView />
    </>
  );
}
