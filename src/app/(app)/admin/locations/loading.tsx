import { PageHeaderSkeleton, TableSkeleton } from "@/components/shared/skeletons";

export default function LocationsLoading() {
  return (
    <>
      <PageHeaderSkeleton withAction />
      <TableSkeleton rows={5} columns={4} />
    </>
  );
}
