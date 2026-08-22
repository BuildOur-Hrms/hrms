import type { Metadata } from "next";
import { Suspense } from "react";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Set your password" };

/**
 * Serves both flows. `?kind=invite` activates a newly created account,
 * `?kind=reset` (the default) replaces a forgotten password. The kind is also
 * checked server-side against the stored token, so a tampered query string
 * cannot turn a reset link into an invite.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
