"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2 } from "lucide-react";
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

interface ShiftSummary {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  isDefault: boolean;
}

interface Assignment {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  shift: ShiftSummary;
}

/** Today as `YYYY-MM-DD`, matching what the API expects. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Shift history for one employee, with the current assignment first.
 *
 * History is shown rather than just the current shift because a past month's
 * attendance was calculated against whatever was in force then — so "why does
 * March look different" is a question this panel should be able to answer.
 */
export function ShiftAssignment({
  employeeId,
  canManage,
}: {
  employeeId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const queryKey = ["employees", employeeId, "shifts"] as const;

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api.get<Assignment[]>(`/employees/${employeeId}/shifts`, undefined, signal),
  });

  const shifts = useQuery({
    queryKey: ["shifts"],
    queryFn: ({ signal }) => api.get<ShiftSummary[]>("/shifts", undefined, signal),
    // Only needed once the dialog can actually be opened.
    enabled: canManage,
  });

  const assign = useMutation({
    mutationFn: (values: { shiftId: string; effectiveFrom: string }) =>
      api.post(`/employees/${employeeId}/shifts`, values),
    onSuccess: () => {
      toast.success("Shift assigned");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey });
      // The shift list carries assignment counts that just moved.
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not assign this shift");
    },
  });

  const assignments = data ?? [];
  const current = assignments.find((a) => a.effectiveTo === null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shift</CardTitle>
        <CardDescription>
          Attendance for a date is measured against whichever shift was in force on that date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : error ? (
          <p className="text-muted-foreground text-sm">Could not load shift history.</p>
        ) : current ? (
          <div className="flex flex-wrap items-center gap-2">
            <Clock className="text-brand size-4" />
            <span className="font-medium">{current.shift.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {current.shift.startTime} – {current.shift.endTime}
            </span>
            <span className="text-muted-foreground text-sm">since {current.effectiveFrom}</span>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No shift assigned. The company default applies until one is set.
          </p>
        )}

        {assignments.length > 1 ? (
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Earlier
            </p>
            {assignments
              .filter((a) => a.effectiveTo !== null)
              .map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className="text-muted-foreground">
                    {a.shift.code}
                  </Badge>
                  <span>{a.shift.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {a.effectiveFrom} → {a.effectiveTo}
                  </span>
                </div>
              ))}
          </div>
        ) : null}

        {canManage ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Change shift
          </Button>
        ) : null}
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change shift</DialogTitle>
            <DialogDescription>
              The current assignment is closed the day before this date. Past attendance keeps the
              rules it was calculated with.
            </DialogDescription>
          </DialogHeader>
          <AssignForm
            shifts={shifts.data ?? []}
            currentShiftId={current?.shift.id ?? null}
            earliest={current?.effectiveFrom ?? null}
            submitting={assign.isPending}
            onCancel={() => setOpen(false)}
            onSubmit={(values) => assign.mutate(values)}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AssignForm({
  shifts,
  currentShiftId,
  earliest,
  submitting,
  onCancel,
  onSubmit,
}: {
  shifts: ShiftSummary[];
  currentShiftId: string | null;
  earliest: string | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: { shiftId: string; effectiveFrom: string }) => void;
}) {
  const [shiftId, setShiftId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());

  // The server rejects a date on or before the current assignment's start;
  // saying so here costs one attribute and saves a round trip.
  const minDate = earliest
    ? new Date(new Date(`${earliest}T00:00:00.000Z`).getTime() + 86_400_000)
        .toISOString()
        .slice(0, 10)
    : undefined;

  const selectable = shifts.filter((s) => s.id !== currentShiftId);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (shiftId) onSubmit({ shiftId, effectiveFrom });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="assign-shift">Shift</Label>
        <Select value={shiftId} onValueChange={(value) => setShiftId(value ?? "")}>
          <SelectTrigger id="assign-shift" className="w-full">
            <SelectValue placeholder="Choose a shift" />
          </SelectTrigger>
          <SelectContent>
            {selectable.map((shift) => (
              <SelectItem key={shift.id} value={shift.id}>
                {shift.name} · {shift.startTime}–{shift.endTime}
                {shift.isDefault ? " · default" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectable.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No other shift to move to. Add one under Shifts first.
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="assign-from">Effective from</Label>
        <Input
          id="assign-from"
          type="date"
          required
          value={effectiveFrom}
          {...(minDate ? { min: minDate } : {})}
          onChange={(event) => setEffectiveFrom(event.target.value)}
        />
        {minDate ? (
          <p className="text-muted-foreground text-xs">
            Must be {minDate} or later — the current assignment started {earliest}.
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !shiftId}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Assign
        </Button>
      </DialogFooter>
    </form>
  );
}
