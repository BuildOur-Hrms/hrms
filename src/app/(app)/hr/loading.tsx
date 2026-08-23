import { PageHeaderSkeleton, PanelHomeSkeleton } from "@/components/shared/skeletons";

export default function HrOverviewLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <PanelHomeSkeleton tiles={4} panels={2} />
    </>
  );
}
