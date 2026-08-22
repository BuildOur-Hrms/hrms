"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect } from "react";

import { ButtonLink } from "@/components/shared/button-link";
import { Button } from "@/components/ui/button";

/**
 * Retry boundary for the authenticated shell.
 *
 * Note what this deliberately does NOT try to do: infer *why* it failed.
 * React strips the message off a server-component error in production and
 * passes only a digest, so branching on the message here would work in
 * development and quietly stop working in production. Permission failures are
 * handled by rendering `<NoAccess />` from the page instead, which leaves this
 * boundary for what it is actually for — something genuinely broke.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, so it has to
    // reach the console for anyone debugging from a screenshot.
    console.error("Unhandled error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center gap-4 text-center">
      <div className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-full">
        <AlertTriangle className="size-5" />
      </div>

      <div className="max-w-md">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          This page failed to load. Trying again often works; if it does not, the reference below
          will let someone find it in the logs.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground mt-3 font-mono text-xs">reference {error.digest}</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button onClick={reset}>
          <RotateCw className="size-4" />
          Try again
        </Button>
        <ButtonLink href="/dashboard" variant="outline">
          Back to dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
