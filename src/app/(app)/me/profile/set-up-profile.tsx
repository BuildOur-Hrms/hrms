"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { employmentTypes } from "@/modules/employees/validators";

/**
 * Setting up your own employee record.
 *
 * Shown to an account that has none — in practice the platform owner, because
 * the seed gives the HR admin a record and not them. What used to be here was
 * a message telling that person to ask their HR team to connect the account,
 * which is advice addressed to the reader.
 *
 * Only the fields a record cannot exist without. Everything else lives on the
 * profile screen this turns into, and asking for it twice would make setup
 * feel like an application form.
 */

interface OrgOptions {
  departments: { id: string; name: string }[];
  designations: { id: string; title: string }[];
  locations: { id: string; name: string }[];
  ready: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
};

export function SetUpProfile({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [joinDate, setJoinDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const options = useQuery({
    queryKey: ["org", "options"],
    queryFn: ({ signal }) => api.get<OrgOptions>("/org/options", undefined, signal),
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post("/me/profile", {
        firstName,
        lastName: lastName || null,
        workEmail: email,
        phone: phone || null,
        departmentId,
        designationId,
        locationId,
        employmentType,
        joinDate,
      }),
    onSuccess: () => {
      toast.success("Profile set up");
      void queryClient.invalidateQueries();
    },
    onError: (error: unknown) =>
      setError(error instanceof Error ? error.message : "Could not set it up"),
  });

  const org = options.data;

  // The record needs a department, a designation and a location, and none of
  // them can be invented here. Saying which are missing beats a form whose
  // dropdowns are empty for no stated reason.
  if (org && !org.ready) {
    const missing = [
      org.departments.length === 0 ? "a department" : null,
      org.designations.length === 0 ? "a designation" : null,
      org.locations.length === 0 ? "a location" : null,
    ].filter(Boolean);

    return (
      <EmptyState
        icon={UserPlus}
        title="The company needs a little structure first"
        description={`Your record has to sit somewhere, and this company has no ${missing.join(" and no ")} yet. Set those up, then come back.`}
      />
    );
  }

  const complete =
    firstName.trim().length > 0 && departmentId && designationId && locationId && joinDate;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your profile</CardTitle>
        <CardDescription>
          This account can sign in but is not yet a person in the company — so it has no attendance,
          no leave balance and no place on any team. This creates that record and links it to{" "}
          {email}.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="grid max-w-2xl gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            submit.mutate();
          }}
        >
          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="setup-first">First name</Label>
              <Input
                id="setup-first"
                required
                maxLength={80}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-last">Last name</Label>
              <Input
                id="setup-last"
                maxLength={80}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Picker
              id="setup-department"
              label="Department"
              placeholder="Choose a department"
              options={(org?.departments ?? []).map((d) => ({ id: d.id, label: d.name }))}
              value={departmentId}
              onChange={setDepartmentId}
            />
            <Picker
              id="setup-designation"
              label="Designation"
              placeholder="Choose a designation"
              options={(org?.designations ?? []).map((d) => ({ id: d.id, label: d.title }))}
              value={designationId}
              onChange={setDesignationId}
            />
            <Picker
              id="setup-location"
              label="Location"
              placeholder="Choose a location"
              options={(org?.locations ?? []).map((l) => ({ id: l.id, label: l.name }))}
              value={locationId}
              onChange={setLocationId}
            />
            <Picker
              id="setup-type"
              label="Employment type"
              placeholder="Choose a type"
              options={employmentTypes.map((type) => ({
                id: type,
                label: TYPE_LABELS[type] ?? type,
              }))}
              value={employmentType}
              onChange={setEmploymentType}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="setup-join">Joined on</Label>
              <Input
                id="setup-join"
                type="date"
                required
                value={joinDate}
                onChange={(event) => setJoinDate(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-phone">Phone</Label>
              <Input
                id="setup-phone"
                maxLength={30}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
          </div>

          <div>
            <Button type="submit" disabled={submit.isPending || !complete}>
              {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create my record
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Picker({
  id,
  label,
  placeholder,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={Object.fromEntries(options.map((option) => [option.id, option.label]))}
        value={value}
        onValueChange={(next) => onChange(next ?? "")}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
