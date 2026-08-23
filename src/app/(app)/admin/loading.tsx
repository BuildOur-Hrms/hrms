import { PageHeaderSkeleton, PanelHomeSkeleton } from "@/components/shared/skeletons";

export default function AdminOverviewLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <PanelHomeSkeleton tiles={4} panels={2} />
    </>
  );
}
