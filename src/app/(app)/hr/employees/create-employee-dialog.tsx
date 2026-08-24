"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
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

/**
 * Adding an employee, optionally for an account that already exists.
 *
 * `forAccount` is the Users screen calling: somebody was invited directly, so
 * they hold a login with no record behind it and cannot be invited again. The
 * form is the same one — a record needs the same facts however it starts —
 * with the invite step dropped, because there is nobody left to invite.
 */
export function CreateEmployeeDialog({
  open,
  onClose,
  forAccount,
}: {
  open: boolean;
  onClose: () => void;
  forAccount?: { id: string; email: string } | undefined;
}) {
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
      // The address they sign in with, so the record and the login agree
      // without anybody typing it twice.
      workEmail: forAccount?.email ?? "",
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
        linkUserId: forAccount?.id ?? null,
        // There is no invite to send to somebody who already signed in.
        invite: forAccount ? false : values.invite,
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

  /**
   * Label maps for the pickers. Base UI resolves a select trigger's text from
   * these; without them the trigger shows the underlying value, which for an
   * org picker means a bare UUID.
   */
  const departmentItems = useMemo(
    () => Object.fromEntries((orgOptions?.departments ?? []).map((d) => [d.id, d.name])),
    [orgOptions],
  );
  const designationItems = useMemo(
    () => Object.fromEntries((orgOptions?.designations ?? []).map((d) => [d.id, d.title])),
    [orgOptions],
  );
  const locationItems = useMemo(
    () => Object.fromEntries((orgOptions?.locations ?? []).map((l) => [l.id, l.name])),
    [orgOptions],
  );
  const managerItems = useMemo(
    () => ({
      [NONE]: "No manager",
      ...Object.fromEntries((managers ?? []).map((m) => [m.id, fullName(m.firstName, m.lastName)])),
    }),
    [managers],
  );
  const typeItems = useMemo(
    () => Object.fromEntries(employmentTypes.map((t) => [t, TYPE_LABELS[t]])),
    [],
  );

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
          <DialogTitle>{forAccount ? "Create their employee record" : "Add employee"}</DialogTitle>
          <DialogDescription>
            {forAccount
              ? `${forAccount.email} has a login but no employee record, so there is nothing for
                 their profile, attendance or leave to hang off. This creates one and connects it.`
              : `An employee code is generated automatically. You can send their login invite now
                 or later.`}
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
              <Field
                label="First name"
                htmlFor="ce-first-name"
                error={errors.firstName?.message}
                required
              >
                <Input id="ce-first-name" autoFocus {...register("firstName")} />
              </Field>
              <Field label="Last name" htmlFor="ce-last-name" error={errors.lastName?.message}>
                <Input id="ce-last-name" {...register("lastName")} />
              </Field>
              <Field label="Work email" htmlFor="ce-work-email" error={errors.workEmail?.message}>
                <Input id="ce-work-email" type="email" {...register("workEmail")} />
              </Field>
              <Field label="Phone" htmlFor="ce-phone" error={errors.phone?.message}>
                <Input id="ce-phone" {...register("phone")} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Department"
                htmlFor="ce-department"
                error={errors.departmentId?.message}
                required
              >
                <Controller
                  control={control}
                  name="departmentId"
                  render={({ field }) => (
                    <Select
                      items={departmentItems}
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger id="ce-department">
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

              <Field
                label="Designation"
                htmlFor="ce-designation"
                error={errors.designationId?.message}
                required
              >
                <Controller
                  control={control}
                  name="designationId"
                  render={({ field }) => (
                    <Select
                      items={designationItems}
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger id="ce-designation">
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

              <Field
                label="Location"
                htmlFor="ce-location"
                error={errors.locationId?.message}
                required
              >
                <Controller
                  control={control}
                  name="locationId"
                  render={({ field }) => (
                    <Select
                      items={locationItems}
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger id="ce-location">
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

              <Field label="Reports to" htmlFor="ce-reports-to" error={errors.managerId?.message}>
                <Controller
                  control={control}
                  name="managerId"
                  render={({ field }) => (
                    <Select
                      items={managerItems}
                      value={field.value ?? NONE}
                      onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                    >
                      <SelectTrigger id="ce-reports-to">
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

            {/*
              Where the contents of those three lists come from.
              
              A company that has only ever had the one seeded department sees
              a picker with a single choice and no way to tell whether that is
              the product's limit or its own setup. Named rather than linked:
              this is a dialog, and following a link from it throws away
              everything typed so far.
            */}
            <p className="text-muted-foreground text-xs">
              Departments and designations are managed under HR → Departments, and locations under
              Admin → Locations.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Employment type"
                htmlFor="ce-employment-type"
                error={errors.employmentType?.message}
                required
              >
                <Controller
                  control={control}
                  name="employmentType"
                  render={({ field }) => (
                    <Select items={typeItems} value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="ce-employment-type">
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

              <Field
                label="Join date"
                htmlFor="ce-join-date"
                error={errors.joinDate?.message}
                required
              >
                <Input id="ce-join-date" type="date" {...register("joinDate")} />
              </Field>

              <Field
                label="Probation ends"
                htmlFor="ce-probation-ends"
                error={errors.probationEndDate?.message}
              >
                <Input id="ce-probation-ends" type="date" {...register("probationEndDate")} />
              </Field>
            </div>

            {forAccount ? null : (
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
            )}

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

/**
 * One labelled control.
 *
 * `htmlFor` is not optional in practice: without it the label is text sitting
 * near a box, so a screen reader announces an unnamed textbox and clicking
 * the label does nothing. Every caller passes it, and the control it names
 * carries the matching id.
 */
function Field({
  label,
  htmlFor,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </Label>
      {children}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
