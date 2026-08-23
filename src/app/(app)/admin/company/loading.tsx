import { DetailCardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

export default function CompanyLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <DetailCardSkeleton fields={8} />
    </>
  );
}
