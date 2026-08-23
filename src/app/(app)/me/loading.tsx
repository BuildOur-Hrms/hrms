import { PageHeaderSkeleton, PanelHomeSkeleton } from "@/components/shared/skeletons";

export default function MyOverviewLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <PanelHomeSkeleton tiles={4} panels={2} />
    </>
  );
}
