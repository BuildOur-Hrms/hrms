import { DetailCardSkeleton, ProfileHeaderSkeleton } from "@/components/shared/skeletons";

export default function ProfileLoading() {
  return (
    <>
      <ProfileHeaderSkeleton />
      <div className="space-y-6">
        <DetailCardSkeleton fields={5} />
        <DetailCardSkeleton fields={6} />
      </div>
    </>
  );
}
