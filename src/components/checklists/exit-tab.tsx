"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ChecklistPanel } from "@/components/checklists/checklist-panel";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useEmployeeExit,
  useExitStep,
  useResign,
  type ExitRequest,
  type ExitStatus,
} from "@/hooks/use-checklists";

/**
 * One person's exit, and the one thing that can happen to it next.
 *
 * Deliberately a single action rather than a row of buttons. The order is
 * fixed, so offering every step at once would mean offering five that will be
 * refused — and a screen full of controls that do not work teaches people to
 * distrust the ones that do.
 */

const STATUS_LABEL: Record<ExitStatus, string> = {
  initiated: "Awaiting approval",
  in_progress: "On notice",
  cleared: "Cleared",
  settled: "Settled",
  completed: "Left",
  cancelled: "Withdrawn",
};

const STATUS_TINT: Record<ExitStatus, string> = {
  initiated: "bg-warning/12 text-warning",
  in_progress: "bg-info/12 text-info",
  cleared: "bg-info/12 text-info",
  settled: "bg-info/12 text-info",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

/** What may happen next, given where the exit is and who is looking. */
function nextStep(request: ExitRequest, canManage: boolean, canApprove: boolean) {
  if (request.status === "initiated") {
    if (!request.approvedAt && canApprove) return "approve" as const;
    if (request.approvedAt && canManage) return "confirm" as const;
    return null;
  }
  if (!canManage) return null;
  if (request.status === "in_progress") return "clear" as const;
  if (request.status === "cleared") return "settlement" as const;
  if (request.status === "settled") return "complete" as const;
  return null;
}

const STEP_LABEL = {
  approve: "Approve the resignation",
  confirm: "Confirm and set the last day",
  clear: "Mark everything cleared",
  settlement: "Record the settlement",
  complete: "Complete the exit",
} as const;

export function ExitTab({
  employeeId,
  employeeName,
  canManage,
  canApprove,
  today,
}: {
  employeeId: string;
  employeeName: string;
  canManage: boolean;
  canApprove: boolean;
  today: string;
}) {
  const exit = useEmployeeExit(employeeId);
  const step = useExitStep();
  const [confirming, setConfirming] = useState(false);
  const [settling, setSettling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [filing, setFiling] = useState(false);

  if (exit.isLoading) return <Skeleton className="h-48 w-full" />;

  const request = exit.data?.request ?? null;

  if (!request || request.status === "cancelled") {
    return (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Leaving</CardTitle>
            <CardDescription>Nothing in progress.</CardDescription>
          </div>
          {/*
            People resign in a corridor, or by email to a manager who forwards
            it. Somebody has to write it down, and making HR ask the leaver to
            file it themselves is how a resignation goes unrecorded for a week.
          */}
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => setFiling(true)}>
              File a resignation
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Nothing in progress"
            description={`${employeeName} has not resigned.`}
          />
        </CardContent>

        <FileDialog
          employeeId={employeeId}
          employeeName={employeeName}
          open={filing}
          onOpenChange={setFiling}
        />
      </Card>
    );
  }

  const next = nextStep(request, canManage, canApprove);

  function run(which: "approve" | "clear" | "complete") {
    step.mutate(
      { id: request!.id, step: which },
      {
        onSuccess: () => toast.success("Done"),
        onError: (error: unknown) =>
          toast.error(error instanceof Error ? error.message : "Could not do that"),
      },
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              Leaving
              <Badge variant="secondary" className={STATUS_TINT[request.status]}>
                {STATUS_LABEL[request.status]}
              </Badge>
            </CardTitle>
            <CardDescription>
              {request.lastWorkingDay
                ? `Last working day ${request.lastWorkingDay.slice(0, 10)}.`
                : `Asked to leave by ${request.requestedLastWorkingDay.slice(0, 10)}; the date is not settled yet.`}
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            {next ? (
              <Button
                size="sm"
                disabled={step.isPending}
                onClick={() => {
                  if (next === "confirm") setConfirming(true);
                  else if (next === "settlement") setSettling(true);
                  else run(next);
                }}
              >
                {step.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {STEP_LABEL[next]}
              </Button>
            ) : null}

            {canManage && !["completed", "cancelled", "settled"].includes(request.status) ? (
              <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
                Withdraw
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Reason given</p>
            <p>{request.reason}</p>
          </div>

          {request.settlementNotes || request.leaveEncashmentDays !== null ? (
            <div>
              <p className="text-muted-foreground text-xs">Settlement</p>
              <p>
                {request.leaveEncashmentDays !== null
                  ? `${Number(request.leaveEncashmentDays)} days of leave to encash. `
                  : ""}
                {request.settlementNotes ?? ""}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Recorded for payroll to pick up. Nothing is calculated here.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exit checklist</CardTitle>
          <CardDescription>
            Everything to hand back and hand over before the last day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChecklistPanel
            tasks={exit.data?.tasks ?? []}
            progress={exit.data?.progress}
            today={today}
            canSettle={canManage}
            emptyMessage="No exit checklist was started — the company has not written one."
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        request={request}
        open={confirming}
        onOpenChange={setConfirming}
        onSubmit={(body) =>
          step.mutate(
            { id: request.id, step: "confirm", body },
            {
              onSuccess: () => {
                toast.success("Confirmed");
                setConfirming(false);
              },
              onError: (error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Could not confirm"),
            },
          )
        }
        pending={step.isPending}
      />

      <SettlementDialog
        open={settling}
        onOpenChange={setSettling}
        onSubmit={(body) =>
          step.mutate(
            { id: request.id, step: "settlement", body },
            {
              onSuccess: () => {
                toast.success("Settlement recorded");
                setSettling(false);
              },
              onError: (error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Could not record it"),
            },
          )
        }
        pending={step.isPending}
      />

      <WithdrawDialog
        employeeName={employeeName}
        open={cancelling}
        onOpenChange={setCancelling}
        onSubmit={(body) =>
          step.mutate(
            { id: request.id, step: "cancel", body },
            {
              onSuccess: () => {
                toast.success("Resignation withdrawn");
                setCancelling(false);
              },
              onError: (error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Could not withdraw it"),
            },
          )
        }
        pending={step.isPending}
      />
    </div>
  );
}

function ConfirmDialog({
  request,
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  request: ExitRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [lastDay, setLastDay] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm the exit</DialogTitle>
          <DialogDescription>
            This puts them on notice and starts the exit checklist. Leave the date empty and it is
            worked out from their notice period.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="exit-last-day">Last working day</Label>
          <Input
            id="exit-last-day"
            type="date"
            value={lastDay}
            onChange={(event) => setLastDay(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            They asked for {request.requestedLastWorkingDay.slice(0, 10)}. Notice is often waived or
            extended, so this is yours to set.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onSubmit({ lastWorkingDay: lastDay || null })}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettlementDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [days, setDays] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record the settlement</DialogTitle>
          <DialogDescription>
            What payroll will need. Written down here rather than worked out — the arithmetic
            belongs with the module that pays it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="settle-days">Leave days to encash</Label>
            <Input
              id="settle-days"
              type="number"
              min={0}
              step="0.5"
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="settle-notes">Anything else owed or owing</Label>
            <Textarea
              id="settle-notes"
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Two months' bonus pending; laptop recovery waived."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSubmit({
                leaveEncashmentDays: days === "" ? null : Number(days),
                settlementNotes: notes.trim() || null,
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({
  employeeName,
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  employeeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw the resignation?</DialogTitle>
          <DialogDescription>
            {employeeName} goes back to active and their outstanding exit tasks are dropped. The
            record of the resignation stays, because it happened.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="withdraw-reason">Why is it being withdrawn?</Label>
          <Textarea
            id="withdraw-reason"
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button
            disabled={reason.trim().length === 0 || pending}
            onClick={() => onSubmit({ cancellationReason: reason.trim() })}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Withdraw it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * HR filing a resignation somebody handed in elsewhere.
 *
 * The same two facts the employee's own form asks for. The date is a request
 * either way — HR settles the real one at the next step.
 */
function FileDialog({
  employeeId,
  employeeName,
  open,
  onOpenChange,
}: {
  employeeId: string;
  employeeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const resign = useResign();
  const [reason, setReason] = useState("");
  const [lastDay, setLastDay] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File a resignation for {employeeName}</DialogTitle>
          <DialogDescription>
            It still needs approving before the date can be settled, the same as one they filed
            themselves.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="file-day">Last working day they asked for</Label>
            <Input
              id="file-day"
              type="date"
              value={lastDay}
              onChange={(event) => setLastDay(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="file-reason">Reason given</Label>
            <Textarea
              id="file-reason"
              rows={3}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length === 0 || lastDay === "" || resign.isPending}
            onClick={() =>
              resign.mutate(
                { employeeId, reason: reason.trim(), requestedLastWorkingDay: lastDay },
                {
                  onSuccess: () => {
                    toast.success("Resignation filed");
                    onOpenChange(false);
                  },
                  onError: (error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "Could not file it"),
                },
              )
            }
          >
            {resign.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            File it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
