import { Building2 } from "lucide-react";

import { ButtonLink } from "@/components/shared/button-link";

/**
 * 404 for addresses that match no route at all.
 *
 * Distinct from `(app)/not-found.tsx`, which renders inside the authenticated
 * shell for a missing record. This one cannot assume a session exists, so it
 * stands alone and offers the sign-in page rather than the dashboard.
 */
export default function NotFound() {
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl">
          <Building2 className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">HRMS</h1>
          <p className="text-muted-foreground text-sm">Employee lifecycle management</p>
        </div>
      </div>

      <div className="max-w-sm">
        <h2 className="text-xl font-semibold tracking-tight">Page not found</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          There is nothing at this address. If you followed a link from an email, it may have
          expired.
        </p>
      </div>

      <ButtonLink href="/login" variant="outline">
        Go to sign in
      </ButtonLink>
    </div>
  );
}
