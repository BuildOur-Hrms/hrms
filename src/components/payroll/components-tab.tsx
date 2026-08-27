"use client";

import { Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateComponent,
  useDeleteComponent,
  useSalaryComponents,
  type SalaryComponent,
} from "@/hooks/use-payroll";

/**
 * The parts a salary is made of.
 *
 * Set up once and then mostly left alone: basic, allowances, and whatever is
 * deducted. A component can be a fixed amount or a percentage of a fixed one
 * — but not a percentage of a percentage, because that is a chain nobody can
 * read off a payslip.
 */

export function ComponentsTab({ canManage }: { canManage: boolean }) {
  const components = useSalaryComponents();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<SalaryComponent | null>(null);
  const remove = useDeleteComponent();

  const rows = components.data ?? [];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Salary components</CardTitle>
            <CardDescription>
              What a salary is built from. Archived rather than deleted, because a payslip names its
              components and one that cannot say what it paid is not a payslip.
            </CardDescription>
          </div>
          {canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              Add component
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {components.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : components.isError ? (
            <EmptyState
              title="Could not load the components"
              description="Something went wrong fetching them. Try again in a moment."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No components yet"
              description="Add at least a basic earning before assigning anybody a salary."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>How it is worked out</TableHead>
                  <TableHead>Prorates</TableHead>
                  {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((component) => (
                  <TableRow key={component.id}>
                    <TableCell className="font-mono text-xs">{component.code}</TableCell>
                    <TableCell className="font-medium">{component.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {component.kind === "earning" ? "Earning" : "Deduction"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {component.calcType === "fixed"
                        ? "A fixed amount"
                        : `A percentage of ${component.baseComponent?.code ?? "—"}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {/* Not a bare tick: "does it shrink when somebody takes
                          unpaid leave" is the question, and yes/no answers it. */}
                      {component.prorates ? "Yes" : "No"}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Archive ${component.name}`}
                            onClick={() => setRemoving(component)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddComponentDialog open={open} onOpenChange={setOpen} components={rows} />

      <Dialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {removing?.name}?</DialogTitle>
            <DialogDescription>
              It stops being available for new salaries. Payslips that already name it keep it —
              nothing already paid changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing.id, {
                  onSuccess: () => {
                    toast.success("Component archived");
                    setRemoving(null);
                  },
                  onError: (error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "Could not archive"),
                });
              }}
            >
              {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddComponentDialog({
  open,
  onOpenChange,
  components,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  components: SalaryComponent[];
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"earning" | "deduction">("earning");
  const [calcType, setCalcType] = useState<"fixed" | "percentage">("fixed");
  const [baseComponentId, setBaseComponentId] = useState("");
  const [prorates, setProrates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateComponent();

  // Only a fixed component can be the base of a percentage.
  const bases = components.filter((component) => component.calcType === "fixed");

  // Base UI reads each trigger's label from these; see the note in preview-tab.
  const kindItems = { earning: "Earning", deduction: "Deduction" };
  const calcItems = { fixed: "A fixed amount", percentage: "A percentage of another component" };
  const baseItems: Record<string, string> = Object.fromEntries(
    bases.map((component) => [component.id, `${component.name} (${component.code})`]),
  );

  const reset = () => {
    setCode("");
    setName("");
    setKind("earning");
    setCalcType("fixed");
    setBaseComponentId("");
    setProrates(true);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a salary component</DialogTitle>
          <DialogDescription>
            The code appears on payslips and in the finance export, so pick something a person
            reading a payslip will recognise.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="component-code">Code</Label>
              <Input
                id="component-code"
                value={code}
                maxLength={20}
                placeholder="BASIC"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="component-name">Name</Label>
              <Input
                id="component-name"
                value={name}
                maxLength={80}
                placeholder="Basic pay"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="component-kind">Kind</Label>
              <Select
                items={kindItems}
                value={kind}
                onValueChange={(value) => setKind((value as typeof kind) ?? kind)}
              >
                <SelectTrigger id="component-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="earning">Earning</SelectItem>
                  <SelectItem value="deduction">Deduction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="component-calc">How it is worked out</Label>
              <Select
                items={calcItems}
                value={calcType}
                onValueChange={(value) => setCalcType((value as typeof calcType) ?? calcType)}
              >
                <SelectTrigger id="component-calc" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">A fixed amount</SelectItem>
                  <SelectItem value="percentage" disabled={bases.length === 0}>
                    A percentage of another component
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {calcType === "percentage" ? (
            <div className="grid gap-2">
              <Label htmlFor="component-base">A percentage of</Label>
              <Select
                items={baseItems}
                value={baseComponentId}
                onValueChange={(value) => setBaseComponentId(value ?? "")}
              >
                <SelectTrigger id="component-base" className="w-full">
                  <SelectValue placeholder="Choose a component" />
                </SelectTrigger>
                <SelectContent>
                  {bases.map((component) => (
                    <SelectItem key={component.id} value={component.id}>
                      {component.name} ({component.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-sm">
                Only fixed components can be a base. A percentage of a percentage is a chain nobody
                can read off a payslip.
              </p>
            </div>
          ) : null}

          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={prorates} onCheckedChange={(next) => setProrates(next === true)} />
            <span>
              Shrinks with unpaid leave
              <span className="text-muted-foreground block text-xs">
                On for pay, off for anything owed in full whatever the days worked.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || !code.trim() || !name.trim()}
            onClick={() => {
              setError(null);
              create.mutate(
                {
                  code: code.trim(),
                  name: name.trim(),
                  kind,
                  calcType,
                  baseComponentId: calcType === "percentage" ? baseComponentId || null : null,
                  prorates,
                  sortOrder: components.length,
                },
                {
                  onSuccess: () => {
                    toast.success("Component added");
                    reset();
                    onOpenChange(false);
                  },
                  onError: (e: unknown) =>
                    setError(e instanceof Error ? e.message : "Could not add the component"),
                },
              );
            }}
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Add component
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
