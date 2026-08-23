import { DetailCardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function MyAttendanceLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <DetailCardSkeleton fields={4} />
    </>
  );
}
