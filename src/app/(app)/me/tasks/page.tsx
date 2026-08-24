import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { MyTasks } from "@/components/tasks/my-tasks";
import { pageCan, requireSession } from "@/lib/page";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage() {
  const session = await requireSession();
  if (!pageCan(session, "performance.view_own"))
    return <NoAccess required="performance.view_own" what="your tasks" />;

  return (
    <>
      <PageHeader
        title="My tasks"
        description="What is set for you this month, how far along it is, and how the last few months went."
      />
      <MyTasks />
    </>
  );
}
