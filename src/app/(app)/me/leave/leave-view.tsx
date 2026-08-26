"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface LeaveBalance {
  id: string | null;
  year: number;
  leaveType: { id: string; name: string; code: string; color: string | null; isPaid: boolean };
  opening: number;
  accrued: number;
  used: number;
  carriedForward: number;
  adjusted: number;
  current: number;
}

export interface LeaveRequest {
  id: string;
  startDate: string;
  endDate: string;
  halfDay: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewNote: string | null;
  leaveType: { id: string; name: string; code: string; color: string | null };
  employee: { id: string; firstName: string; lastName: string | null; employeeCode: string };
}

export const LEAVE_STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/12 text-warning",
  approved: "bg-success/12 text-success",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

/** `1` → `1 day`, `2.5` → `2.5 days`. Half days are real here. */
export function dayLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function MyLeaveView() {
  const queryClient = useQueryClient();
  const year = new Date().getUTCFullYear();
  const [applyOpen, setApplyOpen] = useState(false);

  const balances = useQuery({
    queryKey: ["leave", "balances", year],
    queryFn: ({ signal }) =>
      api.get<LeaveBalance[]>("/leave/balances", { year: String(year) }, signal),
  });

  /*
   * Every leave type, not only the ones with a balance row.
   *
   * The picker used to be built from balances, so a type nobody had allocated
   * yet simply did not appear — and an employee looking at an empty dropdown
   * has no way to tell that from the app being broken. Unpaid leave has the
   * same problem by definition: there is never a balance for it.
   */
  const leaveTypes = useQuery({
    queryKey: ["leave", "types"],
    queryFn: ({ signal }) => api.get<{ id: string; name: string }[]>("/leave-types", {}, signal),
  });

  const requests = useQuery({
    queryKey: ["leave", "requests", "mine"],
    queryFn: ({ signal }) => api.get<LeaveRequest[]>("/leave/requests", { scope: "mine" }, signal),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(`/leave/requests/${id}`),
    onSuccess: () => {
      toast.success("Leave withdrawn");
      void queryClient.invalidateQueries({ queryKey: ["leave"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not withdraw"),
  });

  const rows = requests.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Balances for {year}</CardTitle>
            <CardDescription>
              What is left is what has accrued and carried over, less what you have taken.
            </CardDescription>
          </div>
          <Button onClick={() => setApplyOpen(true)}>
            <CalendarPlus className="size-4" />
            Apply for leave
          </Button>
        </CardHeader>
        <CardContent>
          {balances.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (balances.data ?? []).length === 0 ? (
            <EmptyState
              title="No leave types yet"
              description="HR has not set up any leave types, so there is nothing to apply for."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(balances.data ?? []).map((b) => (
                <div key={b.leaveType.id} className="bg-card rounded-xl border p-4 shadow-xs">
                  <div className="flex items-center gap-2">
                    {b.leaveType.color ? (
                      <span
                        aria-hidden
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: b.leaveType.color }}
                      />
                    ) : null}
                    <p className="text-muted-foreground truncate text-xs font-semibold tracking-wider uppercase">
                      {b.leaveType.name}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "mt-1 text-2xl font-semibold tabular-nums",
                      b.current < 0 && "text-destructive",
                    )}
                  >
                    {b.current}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                    {b.accrued + b.carriedForward + b.opening + b.adjusted} earned · {b.used} taken
                  </p>
                  {!b.leaveType.isPaid ? (
                    <Badge variant="outline" className="text-muted-foreground mt-2">
                      Unpaid
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My requests</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : rows.length === 0 ? (
            <EmptyState title="Nothing requested yet" />
          ) : (
            <ul className="divide-border divide-y">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="font-medium">{row.leaveType.name}</span>
                  <span className="tabular-nums">
                    {row.startDate}
                    {row.endDate !== row.startDate ? ` → ${row.endDate}` : ""}
                  </span>
                  <Badge variant="secondary" className={LEAVE_STATUS_STYLE[row.status]}>
                    {row.status}
                  </Badge>
                  <span className="text-muted-foreground tabular-nums">{dayLabel(row.days)}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                    {row.reason}
                  </span>
                  {row.status === "pending" || row.status === "approved" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(row.id)}
                    >
                      Withdraw
                    </Button>
                  ) : null}
                  {row.reviewNote ? (
                    <span className="text-muted-foreground w-full text-xs">
                      Reviewer: {row.reviewNote}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={applyOpen} onOpenChange={(next) => !next && setApplyOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply for leave</DialogTitle>
            <DialogDescription>
              The day count is worked out from your shift and the holiday calendar, and shown before
              you submit.
            </DialogDescription>
          </DialogHeader>
          <ApplyForm
            balances={balances.data ?? []}
            leaveTypes={leaveTypes.data ?? []}
            onDone={() => {
              setApplyOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["leave"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApplyForm({
  balances,
  leaveTypes,
  onDone,
}: {
  balances: LeaveBalance[];
  leaveTypes: { id: string; name: string }[];
  onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [halfDay, setHalfDay] = useState("none");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const singleDay = startDate === endDate;

  /**
   * The live day count. This is why the endpoint exists: somebody sees a
   * weekend being charged by the sandwich rule *before* submitting, rather
   * than discovering it from their balance afterwards.
   */
  const quote = useQuery({
    queryKey: ["leave", "quote", leaveTypeId, startDate, endDate, halfDay],
    enabled: !!leaveTypeId && !!startDate && !!endDate && endDate >= startDate,
    queryFn: ({ signal }) =>
      api.get<{ days: number; breakdown: { date: string; kind: string; charged: number }[] }>(
        "/leave/quote",
        { leaveTypeId, startDate, endDate, halfDay: singleDay ? halfDay : "none" },
        signal,
      ),
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post("/leave/requests", {
        leaveTypeId,
        startDate,
        endDate,
        halfDay: singleDay ? halfDay : "none",
        reason,
      }),
    onSuccess: () => {
      toast.success("Leave requested");
      onDone();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not submit"),
  });

  const balance = balances.find((b) => b.leaveType.id === leaveTypeId);
  const days = quote.data?.days ?? 0;
  const wouldLeave = balance ? balance.current - days : null;

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

      <div className="grid gap-2">
        <Label htmlFor="leave-type">Type</Label>
        {leaveTypes.length === 0 ? (
          // Said out loud rather than left as an empty dropdown. "There is
          // nothing to choose" and "this is broken" look identical otherwise.
          <p className="text-muted-foreground text-sm">
            No leave types have been set up yet. Ask your HR team to add them.
          </p>
        ) : (
          <Select value={leaveTypeId} onValueChange={(v) => setLeaveTypeId(v ?? "")}>
            <SelectTrigger id="leave-type" className="w-full">
              <SelectValue placeholder="Choose a leave type" />
            </SelectTrigger>
            <SelectContent>
              {leaveTypes.map((type) => {
                const balance = balances.find((b) => b.leaveType.id === type.id);
                return (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                    {balance ? ` · ${balance.current} left` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="leave-start">From</Label>
          <Input
            id="leave-start"
            type="date"
            required
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (endDate < e.target.value) setEndDate(e.target.value);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="leave-end">To</Label>
          <Input
            id="leave-end"
            type="date"
            required
            min={startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      {singleDay ? (
        <div className="grid gap-2">
          <Label htmlFor="leave-half">Half day</Label>
          <Select value={halfDay} onValueChange={(v) => setHalfDay(v ?? "none")}>
            <SelectTrigger id="leave-half" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Full day</SelectItem>
              <SelectItem value="first_half">First half</SelectItem>
              <SelectItem value="second_half">Second half</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {quote.data ? (
        <div className="bg-muted/50 rounded-lg border p-3 text-sm">
          <p>
            This costs <span className="font-semibold tabular-nums">{dayLabel(days)}</span>
            {wouldLeave !== null ? (
              <>
                , leaving{" "}
                <span
                  className={cn("font-semibold tabular-nums", wouldLeave < 0 && "text-destructive")}
                >
                  {wouldLeave}
                </span>
              </>
            ) : null}
            .
          </p>
          {quote.data.breakdown.some((d) => d.kind !== "working" && d.charged > 0) ? (
            // Says out loud that a non-working day is being charged, so the
            // sandwich rule is never a surprise on the balance afterwards.
            <p className="text-muted-foreground mt-1 text-xs">
              Includes{" "}
              {quote.data.breakdown.filter((d) => d.kind !== "working" && d.charged > 0).length}{" "}
              non-working day(s) charged under this type&apos;s sandwich rule.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="leave-reason">Reason</Label>
        <Textarea
          id="leave-reason"
          required
          rows={3}
          minLength={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button type="submit" disabled={submit.isPending || !leaveTypeId || days <= 0}>
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Submit request
        </Button>
      </DialogFooter>
    </form>
  );
}
