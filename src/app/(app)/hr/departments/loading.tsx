import { PageHeaderSkeleton, TableSkeleton } from "@/components/shared/skeletons";

export default function DepartmentsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <TableSkeleton rows={5} columns={3} />
        <TableSkeleton rows={5} columns={3} />
      </div>
    </>
  );
}
