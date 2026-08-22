"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api, applyServerErrors } from "@/lib/api-client";
import { loginSchema, type LoginInput } from "@/modules/auth/validators";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    try {
      await api.post("/auth/login", values);

      // Only in-app paths are honoured — an absolute URL here would make the
      // login page an open redirect.
      const next = searchParams.get("next");
      const destination =
        next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

      router.replace(destination);
      router.refresh();
    } catch (error) {
      setFormError(applyServerErrors(error, setError as never));
      if (error instanceof ApiError && error.code === "RATE_LIMITED") {
        setFormError("Too many attempts. Wait a moment and try again.");
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use the work email your HR team invited.</CardDescription>
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

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-muted-foreground text-sm underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            {errors.password ? (
              <p className="text-destructive text-sm">{errors.password.message}</p>
            ) : null}
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
