import { Lock } from "lucide-react";

import { ButtonLink } from "@/components/shared/button-link";

/**
 * The "you cannot see this" screen.
 *
 * Rendered directly by a page rather than thrown as an error, deliberately. In
 * production React strips the message off a server-component error and hands
 * the boundary only a digest, so a thrown `ForbiddenError` is indistinguishable
 * from a crash — the user gets "something went wrong" for a situation that is
 * completely normal in a permission-driven system.
 *
 * This is cosmetic in the security sense. The API re-checks every permission
 * regardless of what the UI decided to render.
 */
export function NoAccess({
  required,
  what = "this page",
}: {
  /** Shown so an admin can act on it without reading the source. */
  required?: string;
  what?: string;
}) {
  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center gap-4 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Lock className="size-5" />
      </div>

      <div className="max-w-md">
        <h1 className="text-xl font-semibold tracking-tight">You do not have access to {what}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Your account does not hold the permission this page needs. If you think that is wrong, ask
          an HR administrator to check your roles.
        </p>
        {required ? (
          <p className="text-muted-foreground mt-3 font-mono text-xs">requires {required}</p>
        ) : null}
      </div>

      <ButtonLink href="/dashboard" variant="outline">
        Back to dashboard
      </ButtonLink>
    </div>
  );
}
