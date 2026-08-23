import { DetailCardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function HrLeaveLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <DetailCardSkeleton fields={4} />
    </>
  );
}
