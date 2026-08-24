import { PageHeaderSkeleton } from "@/components/shared/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton withAction />
      <Skeleton className="h-64 w-full rounded-xl" />
    </>
  );
}
