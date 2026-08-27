"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, applyServerErrors } from "@/lib/api-client";
import { PASSWORD_MIN_LENGTH } from "@/modules/auth/policy";
import { changePasswordSchema, type ChangePasswordInput } from "@/modules/auth/validators";

export function SecurityView() {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  const change = useMutation({
    mutationFn: (input: ChangePasswordInput) => api.post("/auth/change-password", input),
    onSuccess: () => {
      toast.success("Password changed. Any other sessions have been signed out.");
      reset();
      setFormError(null);
    },
    onError: (error: unknown) => {
      // Field-level problems land on the field; whatever is left over says so
      // once at the top, rather than as a toast that vanishes mid-read.
      setFormError(applyServerErrors(error, setError as never));
    },
  });

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden />
            Change password
          </CardTitle>
          <CardDescription>
            You will stay signed in here. Every other device is signed out, which is the point of
            changing it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={handleSubmit((values) => {
              setFormError(null);
              change.mutate(values);
            })}
          >
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                {...register("currentPassword")}
              />
              {errors.currentPassword ? (
                <p className="text-destructive text-sm">{errors.currentPassword.message}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                {...register("newPassword")}
              />
              {errors.newPassword ? (
                <p className="text-destructive text-sm">{errors.newPassword.message}</p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  At least {PASSWORD_MIN_LENGTH} characters, and not one of the passwords that turn
                  up in breach lists. Your company may require more.
                </p>
              )}
            </div>

            <div>
              <Button type="submit" disabled={isSubmitting || change.isPending}>
                {change.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Change password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
