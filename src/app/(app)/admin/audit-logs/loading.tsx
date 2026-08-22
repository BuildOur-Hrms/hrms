import {
  FilterBarSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

export default function AuditLogsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <FilterBarSkeleton count={3} />
        <TableSkeleton rows={10} columns={5} />
      </div>
    </>
  );
}
