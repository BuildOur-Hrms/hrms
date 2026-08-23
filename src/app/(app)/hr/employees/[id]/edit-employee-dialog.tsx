"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { useManagerOptions, useOrgOptions, useUpdateEmployee } from "@/hooks/use-employees";
import { fullName } from "@/lib/utils";

export interface EditableEmployee {
  id: string;
  firstName: string;
  lastName: string | null;
  workEmail: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  department: { id: string; name: string } | null;
  designation: { id: string; title: string } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string | null } | null;
  employmentType: string;
  joinDate: string;
  probationEndDate: string | null;
}

/**
 * Correcting an employee's details.
 *
 * Until this existed the only way to fix a typo, a promotion or a move
 * between departments was to delete the person and create them again — which
 * loses their code, their history and their account link. The API and its
 * field allowlist were already here; this is the form that was missing.
 *
 * Only fields the caller actually changed are sent. A PATCH that echoed every
 * field back would overwrite anything edited elsewhere in the meantime.
 */
export function EditEmployeeDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EditableEmployee;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {fullName(employee.firstName, employee.lastName)}</DialogTitle>
          <DialogDescription>
            Their employee code, account and history are untouched — only the details below change.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so reopening on a different person starts from their values
            rather than whatever was last typed. */}
        <EditForm key={employee.id} employee={employee} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ employee, onDone }: { employee: EditableEmployee; onDone: () => void }) {
  const { data: org } = useOrgOptions();
  const { data: managers } = useManagerOptions(employee.id);
  const update = useUpdateEmployee(employee.id);

  const [firstName, setFirstName] = useState(employee.firstName);
  const [lastName, setLastName] = useState(employee.lastName ?? "");
  const [workEmail, setWorkEmail] = useState(employee.workEmail ?? "");
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [departmentId, setDepartmentId] = useState(employee.department?.id ?? "");
  const [designationId, setDesignationId] = useState(employee.designation?.id ?? "");
  const [locationId, setLocationId] = useState(employee.location?.id ?? "");
  const [managerId, setManagerId] = useState(employee.manager?.id ?? "");
  const [employmentType, setEmploymentType] = useState(employee.employmentType);
  const [joinDate, setJoinDate] = useState(employee.joinDate);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Send only what moved. Blank optional fields become null — an emptied
    // phone number means "remove it", not "leave it alone".
    const changed: Record<string, unknown> = {};
    if (firstName !== employee.firstName) changed["firstName"] = firstName;
    if (lastName !== (employee.lastName ?? "")) changed["lastName"] = lastName || null;
    if (workEmail !== (employee.workEmail ?? "")) changed["workEmail"] = workEmail || null;
    if (phone !== (employee.phone ?? "")) changed["phone"] = phone || null;
    if (departmentId !== (employee.department?.id ?? "")) changed["departmentId"] = departmentId;
    if (designationId !== (employee.designation?.id ?? ""))
      changed["designationId"] = designationId;
    if (locationId !== (employee.location?.id ?? "")) changed["locationId"] = locationId;
    if (managerId !== (employee.manager?.id ?? "")) changed["managerId"] = managerId || null;
    if (employmentType !== employee.employmentType) changed["employmentType"] = employmentType;
    if (joinDate !== employee.joinDate) changed["joinDate"] = joinDate;

    if (Object.keys(changed).length === 0) {
      onDone();
      return;
    }

    try {
      await update.mutateAsync(changed as never);
      toast.success("Employee updated");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="edit-first">First name</Label>
          <Input
            id="edit-first"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="edit-last">Last name</Label>
          <Input id="edit-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="edit-email">Work email</Label>
          <Input
            id="edit-email"
            type="email"
            value={workEmail}
            onChange={(e) => setWorkEmail(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="edit-phone">Phone</Label>
          <Input id="edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Picker
          id="edit-department"
          label="Department"
          value={departmentId}
          onChange={setDepartmentId}
          options={(org?.departments ?? []).map((d) => ({ id: d.id, label: d.name }))}
        />
        <Picker
          id="edit-designation"
          label="Designation"
          value={designationId}
          onChange={setDesignationId}
          options={(org?.designations ?? []).map((d) => ({ id: d.id, label: d.title }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Picker
          id="edit-location"
          label="Location"
          value={locationId}
          onChange={setLocationId}
          options={(org?.locations ?? []).map((l) => ({ id: l.id, label: l.name }))}
        />
        <Picker
          id="edit-manager"
          label="Reports to"
          value={managerId}
          onChange={setManagerId}
          placeholder="No manager"
          options={(managers ?? []).map((m) => ({
            id: m.id,
            label: fullName(m.firstName, m.lastName),
          }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Picker
          id="edit-type"
          label="Employment type"
          value={employmentType}
          onChange={setEmploymentType}
          options={[
            { id: "full_time", label: "Full time" },
            { id: "part_time", label: "Part time" },
            { id: "contract", label: "Contract" },
            { id: "intern", label: "Intern" },
          ]}
        />
        <div className="grid gap-2">
          <Label htmlFor="edit-join">Join date</Label>
          <Input
            id="edit-join"
            type="date"
            required
            value={joinDate}
            onChange={(e) => setJoinDate(e.target.value)}
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}

function Picker({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder ?? "Choose"} />
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
