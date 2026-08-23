import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/page";

import { NotificationsView } from "./notifications-view";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireSession();

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What has happened, and what the company has announced."
      />
      <NotificationsView />
    </>
  );
}
