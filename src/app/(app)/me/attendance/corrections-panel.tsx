"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
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

export interface Correction {
  id: string;
  workDate: string;
  requestedIn: string | null;
  requestedOut: string | null;
  requestedStatus: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewedAt: string | null;
  reviewNote: string | null;
  employee: { id: string; firstName: string; lastName: string | null; employeeCode: string };
}

export const CORRECTION_STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/12 text-warning",
  approved: "bg-success/12 text-success",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

/** Own corrections: raise one, see where the others got to, withdraw a pending one. */
export function CorrectionsPanel({ defaultDate }: { defaultDate?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "corrections", "mine"],
    queryFn: ({ signal }) =>
      api.get<Correction[]>("/attendance/corrections", { scope: "mine" }, signal),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(`/attendance/corrections/${id}`),
    onSuccess: () => {
      toast.success("Request withdrawn");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not withdraw"),
  });

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Corrections</CardTitle>
        <CardDescription>
          Ask for a day to be fixed when a punch was missed. Your manager reviews it.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Request a correction
        </Button>

        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No corrections raised"
            description="If a day looks wrong, ask for it to be corrected rather than letting it stand."
          />
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="font-medium tabular-nums">{row.workDate}</span>
                <Badge variant="secondary" className={CORRECTION_STATUS_STYLE[row.status]}>
                  {row.status}
                </Badge>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  {row.reason}
                </span>
                {row.status === "pending" ? (
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

      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a correction</DialogTitle>
            <DialogDescription>
              Approving this adds the times you give as manual punches and recalculates the day. It
              does not erase what was originally recorded.
            </DialogDescription>
          </DialogHeader>
          <CorrectionForm
            defaultDate={defaultDate}
            onDone={() => {
              setOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["attendance"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CorrectionForm({ defaultDate, onDone }: { defaultDate?: string; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [workDate, setWorkDate] = useState(defaultDate ?? today);
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/attendance/corrections", body),
    onSuccess: () => {
      toast.success("Correction requested");
      onDone();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not submit"),
  });

  /**
   * The inputs are wall-clock; the API wants instants. Combining them here in
   * the browser's zone is a known approximation — it is right for anyone
   * working where they live, and the reviewer sees the resulting time before
   * approving it.
   */
  function instant(time: string): string | null {
    return time ? new Date(`${workDate}T${time}:00`).toISOString() : null;
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        submit.mutate({
          workDate,
          requestedIn: instant(inTime),
          requestedOut: instant(outTime),
          requestedStatus: status || null,
          reason,
        });
      }}
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-2">
        <Label htmlFor="corr-date">Day</Label>
        <Input
          id="corr-date"
          type="date"
          required
          max={today}
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="corr-in">Check-in</Label>
          <Input
            id="corr-in"
            type="time"
            value={inTime}
            onChange={(e) => setInTime(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="corr-out">Check-out</Label>
          <Input
            id="corr-out"
            type="time"
            value={outTime}
            onChange={(e) => setOutTime(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="corr-status">Or set the day to</Label>
        <Select value={status} onValueChange={(v) => setStatus(v ?? "")}>
          <SelectTrigger id="corr-status" className="w-full">
            <SelectValue placeholder="Leave unchanged" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="present">Present</SelectItem>
            <SelectItem value="half_day">Half day</SelectItem>
            <SelectItem value="on_leave">On leave</SelectItem>
            <SelectItem value="holiday">Holiday</SelectItem>
            <SelectItem value="week_off">Week off</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          For days punches cannot express, like leave that was not reflected.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="corr-reason">Reason</Label>
        <Textarea
          id="corr-reason"
          required
          rows={3}
          minLength={5}
          value={reason}
          placeholder="Badge reader was down; I worked a full day."
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Submit request
        </Button>
      </DialogFooter>
    </form>
  );
}
