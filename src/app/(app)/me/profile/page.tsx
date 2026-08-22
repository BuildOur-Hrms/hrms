import type { Metadata } from "next";

import { requireSession } from "@/lib/page";

import { ProfileView } from "./profile-view";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage() {
  await requireSession();
  return <ProfileView />;
}
