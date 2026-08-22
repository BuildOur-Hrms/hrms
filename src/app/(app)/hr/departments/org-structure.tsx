"use client";

import { Building2, Layers } from "lucide-react";
import { useState } from "react";

import { ManagedList } from "@/components/shared/managed-list";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Department {
  id: string;
  name: string;
  code: string;
  headEmployee: { id: string; firstName: string; lastName: string | null } | null;
  _count: { employees: number };
}

interface Designation {
  id: string;
  title: string;
  code: string;
  level: number;
  _count: { employees: number };
}

export function OrgStructure({
  canManageDepartments,
  canManageDesignations,
}: {
  canManageDepartments: boolean;
  canManageDesignations: boolean;
}) {
  return (
    <Tabs defaultValue="departments">
      <TabsList>
        <TabsTrigger value="departments">Departments</TabsTrigger>
        <TabsTrigger value="designations">Designations</TabsTrigger>
      </TabsList>

      <TabsContent value="departments" className="mt-4">
        <ManagedList<Department>
          resource="departments"
          queryKey={["org", "departments"]}
          singular="Department"
          plural="Departments"
          emptyIcon={Building2}
          emptyDescription="Departments group people for reporting, approvals and org structure."
          canManage={canManageDepartments}
          usageCount={(row) => row._count.employees}
          rowLabel={(row) => row.name}
          columns={[
            { header: "Name", cell: (row) => <span className="font-medium">{row.name}</span> },
            {
              header: "Code",
              cell: (row) => <span className="font-mono text-xs">{row.code}</span>,
            },
            {
              header: "Head",
              cell: (row) =>
                row.headEmployee
                  ? [row.headEmployee.firstName, row.headEmployee.lastName]
                      .filter(Boolean)
                      .join(" ")
                  : "—",
            },
            { header: "Employees", cell: (row) => row._count.employees },
          ]}
          renderForm={({ row, onSubmit, submitting, onCancel }) => (
            <CodeNameForm
              key={row?.id ?? "new"}
              nameLabel="Name"
              namePlaceholder="Engineering"
              initial={{ name: row?.name ?? "", code: row?.code ?? "" }}
              isEditing={!!row}
              submitting={submitting}
              onCancel={onCancel}
              onSubmit={(values) => onSubmit({ name: values.name, code: values.code })}
            />
          )}
        />
      </TabsContent>

      <TabsContent value="designations" className="mt-4">
        <ManagedList<Designation>
          resource="designations"
          queryKey={["org", "designations"]}
          singular="Designation"
          plural="Designations"
          emptyIcon={Layers}
          emptyDescription="Designations are job titles with a seniority level used for ordering."
          canManage={canManageDesignations}
          usageCount={(row) => row._count.employees}
          rowLabel={(row) => row.title}
          columns={[
            { header: "Title", cell: (row) => <span className="font-medium">{row.title}</span> },
            {
              header: "Code",
              cell: (row) => <span className="font-mono text-xs">{row.code}</span>,
            },
            { header: "Level", cell: (row) => row.level },
            { header: "Employees", cell: (row) => row._count.employees },
          ]}
          renderForm={({ row, onSubmit, submitting, onCancel }) => (
            <CodeNameForm
              key={row?.id ?? "new"}
              nameLabel="Title"
              namePlaceholder="Senior Engineer"
              withLevel
              initial={{
                name: row?.title ?? "",
                code: row?.code ?? "",
                level: String(row?.level ?? 1),
              }}
              isEditing={!!row}
              submitting={submitting}
              onCancel={onCancel}
              onSubmit={(values) =>
                onSubmit({ title: values.name, code: values.code, level: Number(values.level) })
              }
            />
          )}
        />
      </TabsContent>
    </Tabs>
  );
}

/**
 * Departments and designations differ only in what the name field is called
 * and whether there is a level, so they share one form.
 */
function CodeNameForm({
  nameLabel,
  namePlaceholder,
  withLevel,
  initial,
  isEditing,
  submitting,
  onCancel,
  onSubmit,
}: {
  nameLabel: string;
  namePlaceholder: string;
  withLevel?: boolean;
  initial: { name: string; code: string; level?: string };
  isEditing: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: { name: string; code: string; level?: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code);
  const [level, setLevel] = useState(initial.level ?? "1");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSubmit({ name, code, ...(withLevel ? { level } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-2">
        <Label htmlFor="ml-name">{nameLabel}</Label>
        <Input
          id="ml-name"
          autoFocus
          required
          value={name}
          placeholder={namePlaceholder}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="ml-code">Code</Label>
          <Input
            id="ml-code"
            required
            value={code}
            placeholder="ENG"
            // Codes appear in exports and imports; keep them uppercase and terse.
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </div>

        {withLevel ? (
          <div className="grid gap-2">
            <Label htmlFor="ml-level">Level</Label>
            <Input
              id="ml-level"
              type="number"
              min={1}
              max={20}
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            />
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {isEditing ? "Save changes" : "Add"}
        </Button>
      </DialogFooter>
    </form>
  );
}
