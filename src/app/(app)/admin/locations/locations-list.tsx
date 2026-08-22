"use client";

import { MapPin } from "lucide-react";
import { useState } from "react";

import { ManagedList } from "@/components/shared/managed-list";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Location {
  id: string;
  name: string;
  code: string;
  address: string | null;
  timezone: string | null;
  _count: { employees: number };
}

export function LocationsList({ canManage }: { canManage: boolean }) {
  return (
    <ManagedList<Location>
      resource="locations"
      queryKey={["org", "locations"]}
      singular="Location"
      plural="Locations"
      emptyIcon={MapPin}
      emptyDescription="Locations are offices or branches. Holiday calendars can differ per location."
      canManage={canManage}
      usageCount={(row) => row._count.employees}
      rowLabel={(row) => row.name}
      columns={[
        { header: "Name", cell: (row) => <span className="font-medium">{row.name}</span> },
        { header: "Code", cell: (row) => <span className="font-mono text-xs">{row.code}</span> },
        { header: "Timezone", cell: (row) => row.timezone ?? "Company default" },
        { header: "Employees", cell: (row) => row._count.employees },
      ]}
      renderForm={({ row, onSubmit, submitting, onCancel }) => (
        <LocationForm
          key={row?.id ?? "new"}
          initial={row}
          submitting={submitting}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      )}
    />
  );
}

function LocationForm({
  initial,
  submitting,
  onCancel,
  onSubmit,
}: {
  initial: Location | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSubmit({
        name,
        code,
        address: address || null,
        // Blank means "inherit the company timezone", which is the common case.
        timezone: timezone || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="loc-name">Name</Label>
          <Input
            id="loc-name"
            autoFocus
            required
            value={name}
            placeholder="Head Office"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="loc-code">Code</Label>
          <Input
            id="loc-code"
            required
            value={code}
            placeholder="HQ"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="loc-address">Address</Label>
        <Textarea
          id="loc-address"
          rows={3}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="loc-tz">Timezone</Label>
        <Input
          id="loc-tz"
          value={timezone}
          placeholder="Leave blank to use the company timezone"
          onChange={(event) => setTimezone(event.target.value)}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {initial ? "Save changes" : "Add location"}
        </Button>
      </DialogFooter>
    </form>
  );
}
