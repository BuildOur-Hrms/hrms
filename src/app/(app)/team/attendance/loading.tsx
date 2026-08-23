import { PageHeaderSkeleton, TableSkeleton } from "@/components/shared/skeletons";

export default function TeamAttendanceLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <TableSkeleton rows={6} columns={8} />
    </>
  );
}
