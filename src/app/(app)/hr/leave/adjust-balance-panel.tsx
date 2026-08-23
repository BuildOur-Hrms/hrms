"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Scale } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { fullName } from "@/lib/utils";

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string | null;
  employeeCode: string;
}

interface LeaveTypeOption {
  id: string;
  name: string;
  code: string;
}

interface Balance {
  leaveType: { id: string; name: string; code: string };
  current: number;
  accrued: number;
  used: number;
  adjusted: number;
}

/**
 * Manual credits and debits.
 *
 * The escape hatch for everything policy cannot express — days bought out,
 * a goodwill grant, an accrual that ran against the wrong policy. It adds to
 * whatever adjustment already exists rather than replacing it, so two
 * corrections in a year both stand, and the reason is mandatory because an
 * unexplained adjustment is indistinguishable from a mistake six months on.
 */
export function AdjustBalancePanel() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Balance adjustments</CardTitle>
          <CardDescription>
            Credit or debit somebody&apos;s balance directly, for what policy cannot express. Every
            adjustment is audited with its reason.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Scale className="size-4" />
          Adjust a balance
        </Button>
      </CardHeader>

      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent>
          <AdjustForm
            onDone={() => {
              setOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["leave"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AdjustForm({ onDone }: { onDone: () => void }) {
  const year = new Date().getUTCFullYear();
  const [q, setQ] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const employees = useQuery({
    queryKey: ["employees", "adjust-picker", q],
    queryFn: ({ signal }) => api.get<EmployeeOption[]>("/employees", { q, pageSize: "20" }, signal),
  });

  const types = useQuery({
    queryKey: ["leave", "types"],
    queryFn: ({ signal }) => api.get<LeaveTypeOption[]>("/leave-types", undefined, signal),
  });

  // Their current position, so an adjustment is made with the number in view
  // rather than from memory.
  const balances = useQuery({
    queryKey: ["leave", "balances", employeeId, year],
    enabled: !!employeeId,
    queryFn: ({ signal }) =>
      api.get<Balance[]>("/leave/balances", { year: String(year), employeeId }, signal),
  });

  const current = balances.data?.find((b) => b.leaveType.id === leaveTypeId);

  const submit = useMutation({
    mutationFn: () =>
      api.post("/leave/balances/adjust", {
        employeeId,
        leaveTypeId,
        year,
        days: Number(days),
        reason,
      }),
    onSuccess: () => {
      toast.success("Balance adjusted");
      onDone();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not adjust"),
  });

  const delta = Number(days) || 0;

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
        <DialogTitle>Adjust a balance</DialogTitle>
        <DialogDescription>
          Positive credits, negative debits. Applied to {year} and added to any earlier adjustment
          rather than replacing it.
        </DialogDescription>
      </DialogHeader>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-2">
        <Label htmlFor="adjust-search">Employee</Label>
        <Input
          id="adjust-search"
          placeholder="Search by name or code"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select value={employeeId} onValueChange={(v) => setEmployeeId(v ?? "")}>
          <SelectTrigger className="w-full" aria-label="Employee">
            <SelectValue placeholder="Choose an employee" />
          </SelectTrigger>
          <SelectContent>
            {(employees.data ?? []).map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {fullName(e.firstName, e.lastName)} · {e.employeeCode}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="adjust-type">Leave type</Label>
        <Select value={leaveTypeId} onValueChange={(v) => setLeaveTypeId(v ?? "")}>
          <SelectTrigger id="adjust-type" className="w-full">
            <SelectValue placeholder="Choose a type" />
          </SelectTrigger>
          <SelectContent>
            {(types.data ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="adjust-days">Days</Label>
        <Input
          id="adjust-days"
          type="number"
          step="0.5"
          required
          value={days}
          placeholder="e.g. 2 or -1.5"
          onChange={(e) => setDays(e.target.value)}
        />
        {current ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            Currently {current.current} → {Math.round((current.current + delta) * 100) / 100} after
            this.
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="adjust-reason">Reason</Label>
        <Textarea
          id="adjust-reason"
          required
          rows={3}
          minLength={5}
          value={reason}
          placeholder="Encashed 2 days with the October payroll."
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button
          type="submit"
          disabled={submit.isPending || !employeeId || !leaveTypeId || delta === 0}
        >
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Apply adjustment
        </Button>
      </DialogFooter>
    </form>
  );
}
