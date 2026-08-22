import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { requirePagePermission, requireSession } from "@/lib/page";

import { AuditViewer } from "./audit-viewer";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditLogsPage() {
  const session = await requireSession();
  requirePagePermission(session, "audit.view_all");

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of who changed what. Entries cannot be edited or deleted."
      />
      <AuditViewer />
    </>
  );
}
