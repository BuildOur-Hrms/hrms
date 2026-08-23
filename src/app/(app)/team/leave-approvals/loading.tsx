import { DetailCardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function TeamLeaveApprovalsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <DetailCardSkeleton fields={3} />
    </>
  );
}
