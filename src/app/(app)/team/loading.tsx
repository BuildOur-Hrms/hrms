import { PageHeaderSkeleton, TableSkeleton } from "@/components/shared/skeletons";

export default function TeamLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <TableSkeleton rows={6} columns={5} />
    </>
  );
}
