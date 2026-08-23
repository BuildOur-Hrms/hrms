import { DetailCardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function SettingsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <DetailCardSkeleton fields={10} />
    </>
  );
}
