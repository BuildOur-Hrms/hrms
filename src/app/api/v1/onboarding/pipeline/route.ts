import { withApi } from "@/lib/api";
import { onboardingPipeline } from "@/modules/checklists/service";

export const runtime = "nodejs";

/** Everybody still onboarding, with how far along each of them is. */
export const GET = withApi({ permission: "onboarding.view_all" }, async ({ ctx }) =>
  onboardingPipeline(ctx),
);
