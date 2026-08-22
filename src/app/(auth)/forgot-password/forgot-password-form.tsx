"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, applyServerErrors } from "@/lib/api-client";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/modules/auth/validators";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);
    try {
      await api.post("/auth/forgot-password", values);
      setSent(true);
    } catch (error) {
      setFormError(applyServerErrors(error, setError as never));
    }
  }

  // Always the same confirmation, whether or not the address exists — the
  // screen must not become a way to test which emails are employees.
  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" />
            Check your inbox
          </CardTitle>
          <CardDescription>
            If that address belongs to an account, a reset link is on its way. It is valid for one
            hour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" render={<Link href="/login" />}>
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot your password?</CardTitle>
        <CardDescription>We will email you a link to set a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            {errors.email ? (
              <p className="text-destructive text-sm">{errors.email.message}</p>
            ) : null}
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Send reset link
          </Button>

          <Button variant="ghost" className="w-full" render={<Link href="/login" />}>
            Back to sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
