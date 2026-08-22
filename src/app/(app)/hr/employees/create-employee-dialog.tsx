"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { applyServerErrors } from "@/lib/api-client";
import { fullName } from "@/lib/utils";
import {
  createEmployeeSchema,
  employmentTypes,
  type CreateEmployeeFormValues,
  type CreateEmployeeInput,
} from "@/modules/employees/validators";

import { useCreateEmployee, useManagerOptions, useOrgOptions } from "@/hooks/use-employees";

const NONE = "__none__";

const TYPE_LABELS: Record<(typeof employmentTypes)[number], string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
};

export function CreateEmployeeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: orgOptions, isLoading: loadingOrg } = useOrgOptions();
  const { data: managers } = useManagerOptions();
  const createEmployee = useCreateEmployee();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
    // Typed on the schema's input side, with the submit handler receiving the
    // parsed output — `.default()` fields are optional in, required out.
  } = useForm<CreateEmployeeFormValues, unknown, CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      workEmail: "",
      employmentType: "full_time",
      status: "onboarding",
      joinDate: new Date().toISOString().slice(0, 10),
      invite: false,
    },
  });

  async function onSubmit(values: CreateEmployeeInput) {
    setFormError(null);
    try {
      // Empty optional strings would fail the email/date validators server-side.
      const payload = {
        ...values,
        lastName: values.lastName || null,
        workEmail: values.workEmail || null,
        managerId: values.managerId || null,
        probationEndDate: values.probationEndDate || null,
      };

      const result = await createEmployee.mutateAsync(payload as CreateEmployeeInput);

      toast.success(`${fullName(values.firstName, values.lastName)} added`, {
        description: result.invite?.inviteUrl
          ? "Invite created. The link is in the server log while email is in console mode."
          : values.invite
            ? "Invite email sent."
            : undefined,
      });

      reset();
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, setError as never));
    }
  }

  const orgReady = orgOptions?.ready ?? false;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          setFormError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add employee</DialogTitle>
          <DialogDescription>
            An employee code is generated automatically. You can send their login invite now or
            later.
          </DialogDescription>
        </DialogHeader>

        {loadingOrg ? (
          <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading options
          </div>
        ) : !orgReady ? (
          <Alert>
            <AlertDescription>
              Add at least one location, department and designation before creating employees.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" error={errors.firstName?.message} required>
                <Input autoFocus {...register("firstName")} />
              </Field>
              <Field label="Last name" error={errors.lastName?.message}>
                <Input {...register("lastName")} />
              </Field>
              <Field label="Work email" error={errors.workEmail?.message}>
                <Input type="email" {...register("workEmail")} />
              </Field>
              <Field label="Phone" error={errors.phone?.message}>
                <Input {...register("phone")} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department" error={errors.departmentId?.message} required>
                <Controller
                  control={control}
                  name="departmentId"
                  render={({ field }) => (
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgOptions?.departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="Designation" error={errors.designationId?.message} required>
                <Controller
                  control={control}
                  name="designationId"
                  render={({ field }) => (
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgOptions?.designations.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="Location" error={errors.locationId?.message} required>
                <Controller
                  control={control}
                  name="locationId"
                  render={({ field }) => (
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgOptions?.locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="Reports to" error={errors.managerId?.message}>
                <Controller
                  control={control}
                  name="managerId"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? NONE}
                      onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No manager" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No manager</SelectItem>
                        {managers?.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {fullName(m.firstName, m.lastName)}
                            {m.designation ? ` · ${m.designation.title}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Employment type" error={errors.employmentType?.message} required>
                <Controller
                  control={control}
                  name="employmentType"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {employmentTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="Join date" error={errors.joinDate?.message} required>
                <Input type="date" {...register("joinDate")} />
              </Field>

              <Field label="Probation ends" error={errors.probationEndDate?.message}>
                <Input type="date" {...register("probationEndDate")} />
              </Field>
            </div>

            <Controller
              control={control}
              name="invite"
              render={({ field }) => (
                <label className="flex items-start gap-2.5 text-sm">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                  <span>
                    Send a login invite now
                    <span className="text-muted-foreground block text-xs">
                      Requires a work email. They set their own password from the emailed link.
                    </span>
                  </span>
                </label>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Add employee
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>
        {label}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </Label>
      {children}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
