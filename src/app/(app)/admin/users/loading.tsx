import { PageHeaderSkeleton, TableSkeleton } from "@/components/shared/skeletons";

export default function AdminUsersLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <TableSkeleton rows={6} columns={5} />
    </>
  );
}
