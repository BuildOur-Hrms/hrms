"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Settings2 } from "lucide-react";
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
import { api } from "@/lib/api-client";

interface Policy {
  accrualFrequency: "monthly" | "yearly" | "none";
  accrualAmount: number;
  maxCarryForward: number;
  maxNegative: number;
  minNoticeDays: number;
  maxConsecutiveDays: number | null;
  applicableAfterProbation: boolean;
  sandwichRule: boolean;
}

interface LeaveType {
  id: string;
  name: string;
  code: string;
  isPaid: boolean;
  color: string | null;
  requiresAttachment: boolean;
  policy: Policy | null;
}

/** Leave types and the one policy each carries. */
export function TypesPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["leave", "types"],
    queryFn: ({ signal }) => api.get<LeaveType[]>("/leave-types", undefined, signal),
  });

  const rows = data ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["leave"] });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Leave types</CardTitle>
          <CardDescription>
            The policy decides accrual, carry-forward and how the sandwich rule counts a weekend.
          </CardDescription>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add type
          </Button>
        ) : null}
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No leave types"
            description="Nobody can request leave until at least one type exists."
          />
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                {row.color ? (
                  <span
                    aria-hidden
                    className="size-3 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                ) : null}
                <span className="font-medium">{row.name}</span>
                <span className="text-muted-foreground font-mono text-xs">{row.code}</span>
                {!row.isPaid ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    Unpaid
                  </Badge>
                ) : null}
                {row.policy ? (
                  <span className="text-muted-foreground text-sm">
                    {row.policy.accrualFrequency === "none"
                      ? "No accrual"
                      : `${row.policy.accrualAmount}/${row.policy.accrualFrequency === "monthly" ? "month" : "year"}`}
                    {row.policy.sandwichRule ? " · sandwich" : ""}
                    {row.policy.maxCarryForward > 0
                      ? ` · carries ${row.policy.maxCarryForward}`
                      : ""}
                  </span>
                ) : (
                  <Badge variant="secondary" className="bg-warning/12 text-warning">
                    No policy
                  </Badge>
                )}
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setEditing(row)}
                  >
                    <Settings2 className="size-4" />
                    Policy
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={(next) => !next && setAddOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a leave type</DialogTitle>
          </DialogHeader>
          <TypeForm
            onDone={() => {
              setAddOpen(false);
              invalidate();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent>
          {editing ? (
            <PolicyForm
              type={editing}
              onDone={() => {
                setEditing(null);
                invalidate();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TypeForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isPaid, setIsPaid] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => api.post("/leave-types", { name, code, isPaid, requiresAttachment: false }),
    onSuccess: () => {
      toast.success("Leave type added");
      onDone();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        submit.mutate();
      }}
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="type-name">Name</Label>
          <Input
            id="type-name"
            required
            autoFocus
            value={name}
            placeholder="Casual leave"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="type-code">Code</Label>
          <Input
            id="type-code"
            required
            value={code}
            placeholder="CL"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox checked={isPaid} onCheckedChange={(c) => setIsPaid(c === true)} />
        <span>
          Paid leave
          <span className="text-muted-foreground block text-xs">
            Unpaid leave still consumes a balance; it just does not pay.
          </span>
        </span>
      </label>

      <DialogFooter>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Add type
        </Button>
      </DialogFooter>
    </form>
  );
}

function PolicyForm({ type, onDone }: { type: LeaveType; onDone: () => void }) {
  const p = type.policy;
  const [accrualFrequency, setAccrualFrequency] = useState(p?.accrualFrequency ?? "none");
  const [accrualAmount, setAccrualAmount] = useState(String(p?.accrualAmount ?? 0));
  const [maxCarryForward, setMaxCarryForward] = useState(String(p?.maxCarryForward ?? 0));
  const [maxNegative, setMaxNegative] = useState(String(p?.maxNegative ?? 0));
  const [minNoticeDays, setMinNoticeDays] = useState(String(p?.minNoticeDays ?? 0));
  const [sandwichRule, setSandwichRule] = useState(p?.sandwichRule ?? false);
  const [afterProbation, setAfterProbation] = useState(p?.applicableAfterProbation ?? false);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.put(`/leave-types/${type.id}/policy`, {
        accrualFrequency,
        accrualAmount: Number(accrualAmount),
        maxCarryForward: Number(maxCarryForward),
        maxNegative: Number(maxNegative),
        minNoticeDays: Number(minNoticeDays),
        applicableAfterProbation: afterProbation,
        sandwichRule,
      }),
    onSuccess: () => {
      toast.success("Policy saved");
      onDone();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        submit.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{type.name} policy</DialogTitle>
        <DialogDescription>
          Saving replaces the current policy. Days already accrued under the old rules keep their
          value — they are a number, not a rule.
        </DialogDescription>
      </DialogHeader>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="policy-freq">Accrues</Label>
          <Select
            value={accrualFrequency}
            onValueChange={(v) => setAccrualFrequency((v ?? "none") as Policy["accrualFrequency"])}
          >
            <SelectTrigger id="policy-freq" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Never</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="policy-amount">Days per period</Label>
          <Input
            id="policy-amount"
            type="number"
            step="0.5"
            min={0}
            disabled={accrualFrequency === "none"}
            value={accrualAmount}
            onChange={(e) => setAccrualAmount(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="policy-carry">Carry forward</Label>
          <Input
            id="policy-carry"
            type="number"
            step="0.5"
            min={0}
            value={maxCarryForward}
            onChange={(e) => setMaxCarryForward(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="policy-negative">Allowed negative</Label>
          <Input
            id="policy-negative"
            type="number"
            step="0.5"
            min={0}
            value={maxNegative}
            onChange={(e) => setMaxNegative(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="policy-notice">Notice days</Label>
          <Input
            id="policy-notice"
            type="number"
            min={0}
            value={minNoticeDays}
            onChange={(e) => setMinNoticeDays(e.target.value)}
          />
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox checked={sandwichRule} onCheckedChange={(c) => setSandwichRule(c === true)} />
        <span>
          Sandwich rule
          <span className="text-muted-foreground block text-xs">
            Charges weekends and holidays that fall <em>inside</em> a leave span. Ones next to the
            span are never charged.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox checked={afterProbation} onCheckedChange={(c) => setAfterProbation(c === true)} />
        <span>
          Only after probation
          <span className="text-muted-foreground block text-xs">
            Requests starting on or before the probation end date are refused.
          </span>
        </span>
      </label>

      <DialogFooter>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save policy
        </Button>
      </DialogFooter>
    </form>
  );
}
