import { DetailCardSkeleton, ProfileHeaderSkeleton } from "@/components/shared/skeletons";

export default function EmployeeDetailLoading() {
  return (
    <>
      <ProfileHeaderSkeleton />
      <DetailCardSkeleton fields={4} />
    </>
  );
}
