import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { requirePagePermission, requireSession } from "@/lib/page";

import { RolesView } from "./roles-view";

export const metadata: Metadata = { title: "Roles" };

export default async function RolesPage() {
  const session = await requireSession();
  requirePagePermission(session, "roles.view_all");

  return (
    <>
      <PageHeader
        title="Roles and permissions"
        description="What each role is allowed to do, as the system actually evaluates it."
      />
      <RolesView />
    </>
  );
}
