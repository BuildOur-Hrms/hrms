import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { TaskBoard } from "@/components/tasks/task-board";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "Task completion" };

export default async function HrTasksPage() {
  const session = await requireSession();
  if (!pageCan(session, "performance.view_all"))
    return <NoAccess required="performance.view_all" what="company task completion" />;

  return (
    <>
      <PageHeader
        title="Task completion"
        description="Weighted completion per person, month by month. Assigned work is the figure that counts; what people add for themselves is shown beside it, never blended in."
      />
      <TaskBoard scope="all" canAssign={pageCan(session, "performance.create")} />
    </>
  );
}
