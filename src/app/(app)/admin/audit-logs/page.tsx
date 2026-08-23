import type { Metadata } from "next";

import { NoAccess } from "@/components/shared/no-access";
import { PageHeader } from "@/components/shared/page-header";
import { pageCan, requireSession } from "@/lib/page";

import { AuditViewer } from "./audit-viewer";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditLogsPage() {
  const session = await requireSession();
  if (!pageCan(session, "audit.view_all"))
    return <NoAccess required="audit.view_all" what="the audit log" />;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of who changed what. Entries cannot be edited or deleted."
      />
      <AuditViewer canExport={pageCan(session, "audit.export")} />
    </>
  );
}
