"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";

/**
 * HR entering a day for somebody who could not.
 *
 * The reason field is required and it is not paperwork: this is the one place
 * in attendance where a record appears that nobody asked for, and six months
 * later the only thing standing between it and an argument is the sentence
 * whoever typed it left behind.
 */

export interface ManualEntryTarget {
  employeeId: string;
  employeeName: string;
  workDate: string;
}

const KEEP = "__keep__";

/** Wall-clock `HH:MM` on the work date, as the instant the API expects. */
function instantFor(workDate: string, time: string): string | null {
  if (!time) return null;
  return new Date(`${workDate}T${time}:00.000Z`).toISOString();
}

export function ManualEntryDialog({
  target,
  onClose,
}: {
  target: ManualEntryTarget | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [status, setStatus] = useState(KEEP);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCheckIn("");
    setCheckOut("");
    setStatus(KEEP);
    setReason("");
    setError(null);
  }

  const submit = useMutation({
    mutationFn: () =>
      api.post("/attendance/manual", {
        employeeId: target!.employeeId,
        workDate: target!.workDate,
        checkIn: instantFor(target!.workDate, checkIn),
        checkOut: instantFor(target!.workDate, checkOut),
        status: status === KEEP ? null : status,
        reason,
      }),
    onSuccess: () => {
      toast.success("Day entered");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      reset();
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  const nothingToSave = !checkIn && !checkOut && status === KEEP;

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
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
              Enter {target?.workDate} for {target?.employeeName}
            </DialogTitle>
            <DialogDescription>
              Recorded as a manual entry against your name, and kept when the day is recalculated.
            </DialogDescription>
          </DialogHeader>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="manual-in">Check-in</Label>
              <Input
                id="manual-in"
                type="time"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-out">Check-out</Label>
              <Input
                id="manual-out"
                type="time"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="manual-status">Or set the day to</Label>
            <Select value={status} onValueChange={(v) => setStatus(v ?? KEEP)}>
              <SelectTrigger id="manual-status" className="w-full">
                <SelectValue placeholder="Leave to the calculation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>Leave to the calculation</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="half_day">Half day</SelectItem>
                <SelectItem value="on_leave">On leave</SelectItem>
                <SelectItem value="holiday">Holiday</SelectItem>
                <SelectItem value="week_off">Week off</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              For days punches cannot express. A status set here wins over whatever the times work
              out to.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="manual-reason">Reason</Label>
            <Textarea
              id="manual-reason"
              required
              rows={3}
              minLength={5}
              value={reason}
              placeholder="Worked from the client site; no badge reader there."
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submit.isPending || nothingToSave}>
              {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save the day
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
