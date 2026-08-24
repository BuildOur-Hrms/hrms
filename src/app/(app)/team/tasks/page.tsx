import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { TaskBoard } from "@/components/tasks/task-board";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Team tasks" };

export default async function TeamTasksPage() {
  const session = await requireSession();
  if (!pageCan(session, "performance.view_team"))
    return <NoAccess required="performance.view_team" what="your team's tasks" />;

  return (
    <>
      <PageHeader
        title="Team tasks"
        description="What your reports are working on this month, and how far along each of them is."
      />
      <TaskBoard scope="team" canAssign={pageCan(session, "performance.create")} />
    </>
  );
}
