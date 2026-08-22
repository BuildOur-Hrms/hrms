import {
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
} from "@/components/shared/skeletons";

/**
 * Fallback for any route in the shell without its own loading file. Generic on
 * purpose — a heading, some tiles, a table covers most screens here closely
 * enough not to jump.
 */
export default function AppLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <StatCardsSkeleton />
      <div className="mt-6">
        <TableSkeleton rows={6} />
      </div>
    </>
  );
}
