"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface MonthLock {
  id: string;
  year: number;
  month: number;
  lockedAt: string;
  note: string | null;
  user: { id: string; email: string };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The payroll freeze, a year at a time.
 *
 * Locking and reopening are separate confirmations rather than one toggle:
 * reopening a month payroll has already run against is a decision someone
 * should have to name, not one they reach by clicking the same square twice.
 */
export function MonthLocks({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [acting, setActing] = useState<{ month: number; action: "lock" | "reopen" } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "locks", year],
    queryFn: ({ signal }) =>
      api.get<MonthLock[]>("/attendance/locks", { year: String(year) }, signal),
  });

  const locked = new Map((data ?? []).map((l) => [l.month, l]));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Payroll lock</CardTitle>
          <CardDescription>
            A locked month stops moving entirely — no punches, no corrections, no recalculation.
          </CardDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setYear((y) => y - 1)}>
            {year - 1}
          </Button>
          <span className="px-1 font-semibold tabular-nums">{year}</span>
          <Button variant="outline" size="sm" onClick={() => setYear((y) => y + 1)}>
            {year + 1}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {MONTHS.map((label, index) => {
              const month = index + 1;
              const lock = locked.get(month);
              return (
                <button
                  key={label}
                  type="button"
                  disabled={!canManage}
                  onClick={() => setActing({ month, action: lock ? "reopen" : "lock" })}
                  title={
                    lock
                      ? `Locked ${new Date(lock.lockedAt).toLocaleDateString("en-GB")} by ${lock.user.email}`
                      : "Open"
                  }
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-sm transition-colors",
                    lock
                      ? "bg-brand-soft text-brand-soft-foreground border-brand/25"
                      : "bg-card border-border hover:bg-muted",
                    !canManage && "cursor-not-allowed opacity-60",
                  )}
                >
                  {lock ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {(data ?? []).length > 0 ? (
          <ul className="mt-4 space-y-1.5 border-t pt-4">
            {(data ?? []).map((lock) => (
              <li key={lock.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary" className="bg-brand-soft text-brand-soft-foreground">
                  {MONTHS[lock.month - 1]} {lock.year}
                </Badge>
                <span className="text-muted-foreground">
                  locked by {lock.user.email} on{" "}
                  {new Date(lock.lockedAt).toLocaleDateString("en-GB")}
                </span>
                {lock.note ? <span className="text-muted-foreground">— {lock.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>

      <Dialog open={!!acting} onOpenChange={(next) => !next && setActing(null)}>
        <DialogContent>
          {acting ? (
            <LockForm
              year={year}
              month={acting.month}
              action={acting.action}
              onDone={() => {
                setActing(null);
                void queryClient.invalidateQueries({ queryKey: ["attendance"] });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LockForm({
  year,
  month,
  action,
  onDone,
}: {
  year: number;
  month: number;
  action: "lock" | "reopen";
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ records: number }>("/attendance/locks", {
        action,
        year,
        month,
        note: note || null,
      }),
    onSuccess: (result) => {
      toast.success(
        action === "lock"
          ? `Locked — ${result.records} days frozen`
          : `Reopened — ${result.records} days released`,
      );
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
        <DialogTitle>
          {action === "lock" ? "Lock" : "Reopen"} {MONTHS[month - 1]} {year}
        </DialogTitle>
        <DialogDescription>
          {action === "lock"
            ? "Nobody will be able to punch, request a correction, or have this month recalculated — including the nightly job."
            : "Attendance in this month becomes editable again. If payroll has already run against these numbers, they can now change."}
        </DialogDescription>
      </DialogHeader>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {action === "lock" ? (
        <div className="grid gap-2">
          <Label htmlFor="lock-note">Note (optional)</Label>
          <Textarea
            id="lock-note"
            rows={2}
            value={note}
            placeholder="Payroll run for August"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type="submit"
          disabled={submit.isPending}
          variant={action === "reopen" ? "destructive" : "default"}
        >
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {action === "lock" ? "Lock the month" : "Reopen the month"}
        </Button>
      </DialogFooter>
    </form>
  );
}
