import type { Metadata } from "next";

import { pageCan, requireSession } from "@/lib/page";

import { ProfileView } from "./profile-view";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage() {
  const session = await requireSession();

  return (
    <ProfileView
      // Not a new privilege: `employee.create` already lets these accounts
      // create a record for anybody in the company. This wires one to
      // themselves rather than sending them round through /hr/employees.
      canSetUp={session.employeeId === null && pageCan(session, "employee.create")}
      email={session.email}
    />
  );
}
