import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsersPage() {
  const session = await requireSession();

  if (!pageCan(session, "users.view_all")) {
    return <NoAccess required="users.view_all" what="user accounts" />;
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Sign-in accounts and the roles that decide what each one can do."
      />
      <UsersView
        canManage={pageCan(session, "users.manage")}
        // Creating the record is an employee-module action, so it is offered
        // only to somebody who could create one from the employee screens.
        canCreateEmployees={pageCan(session, "employee.create")}
      />
    </>
  );
}
