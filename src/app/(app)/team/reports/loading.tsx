import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function TeamReportsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardGridSkeleton count={6} />
    </>
  );
}
