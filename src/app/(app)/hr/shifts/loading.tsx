import { PageHeaderSkeleton, TableSkeleton } from "@/components/shared/skeletons";

export default function ShiftsLoading() {
  return (
    <>
      <PageHeaderSkeleton withAction />
      <TableSkeleton rows={4} columns={5} />
    </>
  );
}
