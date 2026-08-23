import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function HrReportsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardGridSkeleton count={6} />
    </>
  );
}
