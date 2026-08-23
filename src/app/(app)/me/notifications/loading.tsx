import { DetailCardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function NotificationsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <DetailCardSkeleton fields={3} />
    </>
  );
}
