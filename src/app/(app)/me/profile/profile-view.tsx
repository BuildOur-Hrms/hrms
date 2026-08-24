"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { DetailCardSkeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { EmployeeStatusBadge, employmentTypeLabel } from "@/components/shared/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { api, applyServerErrors } from "@/lib/api-client";
import { fullName, initials } from "@/lib/utils";

import { SetUpProfile } from "./set-up-profile";
import {
  emergencyContactSchema,
  updateOwnProfileSchema,
  type EmergencyContactFormValues,
  type EmergencyContactInput,
  type UpdateOwnProfileInput,
} from "@/modules/employees/validators";

interface Profile {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  address: string | null;
  status: string;
  employmentType: string;
  joinDate: string | null;
  probationEndDate: string | null;
  department: { id: string; name: string } | null;
  designation: { id: string; title: string } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string | null } | null;
  emergencyContacts: {
    id: string;
    name: string;
    relationship: string;
    phone: string;
    isPrimary: boolean;
  }[];
}

const profileKey = ["me", "profile"] as const;

export function ProfileView({
  /** Whether this account may create its own employee record. */
  canSetUp = false,
  email,
}: {
  canSetUp?: boolean;
  email: string;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Profile["emergencyContacts"][number] | null>(
    null,
  );

  const { data, isLoading, error } = useQuery({
    queryKey: profileKey,
    queryFn: ({ signal }) => api.get<Profile>("/me/profile", undefined, signal),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: profileKey });

  const deleteContact = useMutation({
    mutationFn: (contactId: string) =>
      api.delete(`/employees/${data!.id}/emergency-contacts/${contactId}`),
    onSuccess: () => {
      toast.success("Contact removed");
      void refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not remove the contact"),
  });

  if (isLoading) {
    return <DetailCardSkeleton fields={5} />;
  }

  if (error || !data) {
    // Somebody who may create employee records can create their own, which is
    // the usual case here: the seed gives the HR admin a record and leaves the
    // platform owner without one. Telling that person to ask their HR team
    // would be advice addressed to the reader.
    if (canSetUp) return <SetUpProfile email={email} />;

    return (
      <EmptyState
        title="No employee record"
        description="This login is not linked to an employee record yet. Ask your HR team to connect them."
      />
    );
  }

  const name = fullName(data.firstName, data.lastName);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-12">
            <AvatarFallback>{initials(data.firstName, data.lastName)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="text-muted-foreground text-sm">
              <span className="font-mono">{data.employeeCode}</span>
              {data.designation ? ` · ${data.designation.title}` : ""}
            </p>
          </div>
        </div>
        <EmployeeStatusBadge status={data.status} />
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Contact details</CardTitle>
            <CardDescription>
              These are yours to keep current. Everything else is maintained by HR.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            Edit
          </Button>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Detail label="Work email" value={data.workEmail} hint="Managed by HR" />
          <Detail label="Personal email" value={data.personalEmail} />
          <Detail label="Phone" value={data.phone} />
          <Detail label="Date of birth" value={data.dateOfBirth} hint="Managed by HR" />
          <Detail label="Address" value={data.address} className="sm:col-span-2" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Detail label="Department" value={data.department?.name} />
          <Detail label="Designation" value={data.designation?.title} />
          <Detail label="Location" value={data.location?.name} />
          <Detail
            label="Reports to"
            value={data.manager ? fullName(data.manager.firstName, data.manager.lastName) : null}
          />
          <Detail label="Employment type" value={employmentTypeLabel(data.employmentType)} />
          <Detail label="Join date" value={data.joinDate} />
          <Detail label="Probation ends" value={data.probationEndDate} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Emergency contacts</CardTitle>
            <CardDescription>Who we should call if something happens at work.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingContact(null);
              setContactOpen(true);
            }}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </CardHeader>
        <CardContent>
          {data.emergencyContacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              None yet. Adding at least one is a good idea.
            </p>
          ) : (
            <div className="divide-y">
              {data.emergencyContacts.map((contact) => (
                <div key={contact.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {contact.name}
                      {contact.isPrimary ? (
                        <Badge variant="secondary" className="ml-2">
                          Primary
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground truncate text-sm">
                      {contact.relationship} · {contact.phone}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${contact.name}`}
                      onClick={() => {
                        setEditingContact(contact);
                        setContactOpen(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${contact.name}`}
                      onClick={() => deleteContact.mutate(contact.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <EditProfileDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        profile={data}
        onSaved={refresh}
      />

      <EmergencyContactDialog
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        employeeId={data.id}
        contact={editingContact}
        onSaved={refresh}
      />
    </div>
  );
}

function EditProfileDialog({
  open,
  onClose,
  profile,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateOwnProfileInput>({
    resolver: zodResolver(updateOwnProfileSchema),
    defaultValues: {
      phone: profile.phone ?? "",
      personalEmail: profile.personalEmail ?? "",
      address: profile.address ?? "",
    },
  });

  async function onSubmit(values: UpdateOwnProfileInput) {
    setFormError(null);
    try {
      await api.patch("/me/profile", {
        phone: values.phone || null,
        personalEmail: values.personalEmail || null,
        address: values.address || null,
      });
      toast.success("Profile updated");
      onSaved();
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, setError as never));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit contact details</DialogTitle>
          <DialogDescription>
            Only these fields are yours to change. Ask HR for anything else.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" {...register("phone")} />
            {errors.phone ? (
              <p className="text-destructive text-sm">{errors.phone.message}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="personalEmail">Personal email</Label>
            <Input id="personalEmail" type="email" {...register("personalEmail")} />
            {errors.personalEmail ? (
              <p className="text-destructive text-sm">{errors.personalEmail.message}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" rows={3} {...register("address")} />
            {errors.address ? (
              <p className="text-destructive text-sm">{errors.address.message}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmergencyContactDialog({
  open,
  onClose,
  employeeId,
  contact,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  contact: Profile["emergencyContacts"][number] | null;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EmergencyContactFormValues, unknown, EmergencyContactInput>({
    resolver: zodResolver(emergencyContactSchema),
    values: {
      name: contact?.name ?? "",
      relationship: contact?.relationship ?? "",
      phone: contact?.phone ?? "",
      isPrimary: contact?.isPrimary ?? false,
    },
  });

  async function onSubmit(values: EmergencyContactInput) {
    setFormError(null);
    try {
      if (contact) {
        await api.patch(`/employees/${employeeId}/emergency-contacts/${contact.id}`, values);
      } else {
        await api.post(`/employees/${employeeId}/emergency-contacts`, values);
      }
      toast.success(contact ? "Contact updated" : "Contact added");
      reset();
      onSaved();
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, setError as never));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add emergency contact"}</DialogTitle>
          <DialogDescription>
            Marking someone primary moves the flag off whoever holds it now.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="contact-name">Name</Label>
            <Input id="contact-name" autoFocus {...register("name")} />
            {errors.name ? <p className="text-destructive text-sm">{errors.name.message}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="relationship">Relationship</Label>
              <Input
                id="relationship"
                placeholder="Spouse, parent…"
                {...register("relationship")}
              />
              {errors.relationship ? (
                <p className="text-destructive text-sm">{errors.relationship.message}</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input id="contact-phone" {...register("phone")} />
              {errors.phone ? (
                <p className="text-destructive text-sm">{errors.phone.message}</p>
              ) : null}
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={watch("isPrimary")}
              onCheckedChange={(checked) => setValue("isPrimary", checked === true)}
            />
            Primary contact
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value?: string | null;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-muted-foreground text-sm">
        {label}
        {hint ? <span className="ml-1.5 text-xs opacity-70">({hint})</span> : null}
      </p>
      <p className="mt-0.5 break-words">{value || "—"}</p>
    </div>
  );
}
