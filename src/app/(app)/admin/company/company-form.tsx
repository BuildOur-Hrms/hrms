"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DetailCardSkeleton } from "@/components/shared/skeletons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, applyServerErrors } from "@/lib/api-client";
import { updateCompanySchema, type UpdateCompanyInput } from "@/modules/org/validators";
import { useState } from "react";

interface Company {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  address: string | null;
  contactEmail: string | null;
  timezone: string;
  currency: string;
}

const companyKey = ["org", "company"] as const;

export function CompanyForm({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: companyKey,
    queryFn: ({ signal }) => api.get<Company>("/companies/current", undefined, signal),
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<UpdateCompanyInput>({
    resolver: zodResolver(updateCompanySchema),
    values: data
      ? {
          name: data.name,
          legalName: data.legalName ?? "",
          address: data.address ?? "",
          contactEmail: data.contactEmail ?? "",
          timezone: data.timezone,
          currency: data.currency,
        }
      : undefined,
  });

  const save = useMutation({
    mutationFn: (values: UpdateCompanyInput) => api.patch("/companies/current", values),
    onSuccess: () => {
      toast.success("Company details updated");
      void queryClient.invalidateQueries({ queryKey: companyKey });
    },
  });

  async function onSubmit(values: UpdateCompanyInput) {
    setFormError(null);
    try {
      await save.mutateAsync({
        ...values,
        legalName: values.legalName || null,
        address: values.address || null,
        contactEmail: values.contactEmail || null,
      });
    } catch (error) {
      setFormError(applyServerErrors(error, setError as never));
    }
  }

  if (isLoading || !data) {
    return <DetailCardSkeleton fields={6} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company details</CardTitle>
        <CardDescription>
          The timezone and currency here are the defaults every date and amount in the system is
          interpreted against.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="name">Display name</Label>
              <Input id="name" disabled={!canManage} {...register("name")} />
              {errors.name ? (
                <p className="text-destructive text-sm">{errors.name.message}</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="legalName">Legal name</Label>
              <Input id="legalName" disabled={!canManage} {...register("legalName")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input
                id="contactEmail"
                type="email"
                disabled={!canManage}
                {...register("contactEmail")}
              />
              {errors.contactEmail ? (
                <p className="text-destructive text-sm">{errors.contactEmail.message}</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="company-slug">Slug</Label>
              {/* Immutable: it identifies the tenant and appears in storage keys. */}
              <Input id="company-slug" value={data.slug} disabled readOnly />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input id="timezone" disabled={!canManage} {...register("timezone")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" maxLength={3} disabled={!canManage} {...register("currency")} />
              {errors.currency ? (
                <p className="text-destructive text-sm">{errors.currency.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="address">Registered address</Label>
            <Textarea id="address" rows={3} disabled={!canManage} {...register("address")} />
          </div>

          {canManage ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={save.isPending || !isDirty}>
                {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save changes
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
