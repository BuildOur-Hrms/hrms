import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { requirePagePermission, requireSession } from "@/lib/page";

import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  requirePagePermission(session, "settings.manage");

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
