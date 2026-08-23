import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { AnnouncementsView } from "./announcements-view";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const session = await requireSession();

  if (!pageCan(session, "announcements.create")) {
    return <NoAccess required="announcements.create" what="announcements" />;
  }

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Broadcast to the whole company or one department. Publishing notifies everyone it reaches."
      />
      <AnnouncementsView />
    </>
  );
}
