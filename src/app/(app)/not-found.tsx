import { Compass } from "lucide-react";

import { ButtonLink } from "@/components/shared/button-link";

/**
 * 404 inside the authenticated shell, so the sidebar and topbar stay put and
 * the person can navigate onward rather than landing on a bare page.
 */
export default function AppNotFound() {
  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center gap-4 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Compass className="size-5" />
      </div>

      <div className="max-w-md">
        <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          This address does not match anything in the app. It may have moved, or the link may be
          from a part of the system that is not built yet.
        </p>
      </div>

      <ButtonLink href="/dashboard" variant="outline">
        Back to dashboard
      </ButtonLink>
    </div>
  );
}
