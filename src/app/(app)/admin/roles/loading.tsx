import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function RolesLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardGridSkeleton count={4} />
    </>
  );
}
