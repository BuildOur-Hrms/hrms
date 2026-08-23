import { DetailCardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function MyLeaveLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <DetailCardSkeleton fields={4} />
    </>
  );
}
