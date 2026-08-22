import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { LocationsList } from "./locations-list";

export const metadata: Metadata = { title: "Locations" };

export default async function LocationsPage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader title="Locations" description="Offices and branches employees are assigned to." />
      <LocationsList canManage={pageCan(session, "company.manage")} />
    </>
  );
}
