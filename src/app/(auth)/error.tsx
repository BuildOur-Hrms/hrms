"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Retry boundary for the sign-in screens.
 *
 * Without one, a failure here falls all the way through to `global-error`,
 * which replaces the whole document — so somebody who cannot log in loses even
 * the page that would let them try again. This keeps the shell and offers the
 * two things that actually help: retry, and a reference for the logs.
 *
 * It says nothing about *why*. These pages run before anyone is
 * authenticated, and an error message here is readable by anyone on the
 * internet.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-full">
        <AlertTriangle className="size-5" />
      </div>

      <div className="max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          We could not load this page. Trying again often works.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground mt-3 font-mono text-xs">reference {error.digest}</p>
        ) : null}
      </div>

      <Button onClick={reset}>
        <RotateCw className="size-4" />
        Try again
      </Button>
    </div>
  );
}
