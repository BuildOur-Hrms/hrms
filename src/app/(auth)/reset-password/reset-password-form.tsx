"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, applyServerErrors } from "@/lib/api-client";
import { resetPasswordSchema, type ResetPasswordInput } from "@/modules/auth/validators";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const isInvite = searchParams.get("kind") === "invite";

  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "" },
  });

  async function onSubmit(values: ResetPasswordInput) {
    setFormError(null);
    try {
      await api.post(isInvite ? "/auth/accept-invite" : "/auth/reset-password", values);
      setDone(true);
    } catch (error) {
      setFormError(applyServerErrors(error, setError as never));
    }
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>This link is incomplete</CardTitle>
          <CardDescription>
            Open the link from your email exactly as it was sent, or request a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" render={<Link href="/forgot-password" />}>
            Request a new link
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" />
            Password set
          </CardTitle>
          <CardDescription>
            {isInvite
              ? "Your account is active. Sign in to get started."
              : "Your password has been changed and you have been signed out everywhere."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" render={<Link href="/login" />}>
            Go to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isInvite ? "Welcome — set your password" : "Choose a new password"}</CardTitle>
        <CardDescription>
          At least 10 characters. A long passphrase beats a short complicated one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <input type="hidden" {...register("token")} />

          <div className="grid gap-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            {errors.password ? (
              <p className="text-destructive text-sm">{errors.password.message}</p>
            ) : null}
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {isInvite ? "Activate account" : "Set new password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
