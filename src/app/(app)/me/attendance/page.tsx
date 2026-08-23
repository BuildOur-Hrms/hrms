import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/page";

import { AttendanceView } from "./attendance-view";

export const metadata: Metadata = { title: "My attendance" };

/**
 * Every signed-in employee can see their own attendance, so there is no
 * permission gate here — the API scopes to the caller's own record and refuses
 * to answer for anyone else.
 */
export default async function MyAttendancePage() {
  await requireSession();

  return (
    <>
      <PageHeader
        title="My attendance"
        description="Check in and out, and see how the day was measured."
      />
      <AttendanceView />
    </>
  );
}
