import {
  FilterBarSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

export default function EmployeesLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <FilterBarSkeleton count={2} />
        <TableSkeleton rows={8} columns={6} />
      </div>
    </>
  );
}
