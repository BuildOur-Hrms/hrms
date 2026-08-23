import { PageHeaderSkeleton, TableSkeleton } from "@/components/shared/skeletons";

export default function HrAttendanceLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <TableSkeleton rows={8} columns={8} />
    </>
  );
}
