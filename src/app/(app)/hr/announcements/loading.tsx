import { DetailCardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function AnnouncementsLoading() {
  return (
    <>
      <PageHeaderSkeleton withAction />
      <DetailCardSkeleton fields={3} />
    </>
  );
}
