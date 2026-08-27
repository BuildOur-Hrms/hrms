"use client";

import { Banknote, Download, Loader2, Lock, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { periodLabel, recentPeriods, RUN_LABEL, RUN_TINT } from "@/components/payroll/parts";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApproveRun, useCreateRun, useRunStatus, useRuns } from "@/hooks/use-payroll";

/**
 * The months payroll has been run for, and what state each is in.
 *
 * A run moves one way: draft → approved → paid. Approving is the step that
 * writes payslips and stops the figures moving, so it asks first; marking
 * paid is a note that money actually left, which only the finance system
 * really knows.
 */

export function RunsTab({ canManage, canApprove }: { canManage: boolean; canApprove: boolean }) {
  const runs = useRuns();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const approve = useApproveRun();
  const status = useRunStatus();

  const rows = runs.data ?? [];
  const pending = confirming ? rows.find((row) => row.id === confirming) : undefined;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Payroll runs</CardTitle>
            <CardDescription>
              One per month. A month cannot be opened until its attendance is locked, because a
              correction after the fact would move figures that have already been paid.
            </CardDescription>
          </div>
          {canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              Open a month
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {runs.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : runs.isError ? (
            <EmptyState
              title="Could not load the runs"
              description="Something went wrong fetching them. Try again in a moment."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No payroll has been run yet"
              description="Open a month once its attendance is locked, check the preview, then approve it."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Payslips</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">
                      {periodLabel(run.year, run.month)}
                    </TableCell>
                    <TableCell>
                      <Badge className={RUN_TINT[run.status]} variant="secondary">
                        {RUN_LABEL[run.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run._count.payslips || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-56 truncate text-sm">
                      {run.note ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {run.status === "draft" && canApprove ? (
                          <Button size="sm" onClick={() => setConfirming(run.id)}>
                            <Lock className="size-3.5" />
                            Approve
                          </Button>
                        ) : null}
                        {run.status === "approved" && canManage ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={status.isPending}
                            onClick={() =>
                              status.mutate(
                                { id: run.id, status: "paid" },
                                {
                                  onSuccess: () => toast.success("Marked as paid"),
                                  onError: (error: unknown) =>
                                    toast.error(
                                      error instanceof Error ? error.message : "Could not update",
                                    ),
                                },
                              )
                            }
                          >
                            Mark paid
                          </Button>
                        ) : null}
                        {run.status !== "draft" ? (
                          // A plain link, not a fetch: the browser downloads
                          // the CSV the same way it would any other file, and
                          // the endpoint already sets the filename.
                          <Button
                            size="sm"
                            variant="outline"
                            // `nativeButton={false}` goes with a link render,
                            // or Base UI keeps button semantics on an <a> and
                            // the result misbehaves for keyboard users. A
                            // plain <a download>, not next/link, because the
                            // point is to fetch a file rather than navigate.
                            nativeButton={false}
                            render={
                              <a
                                href={`/api/v1/payroll/runs/${run.id}/export`}
                                download
                                aria-label={`Export ${periodLabel(run.year, run.month)} as CSV`}
                              />
                            }
                          >
                            <Download className="size-3.5" />
                            CSV
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <OpenMonthDialog open={open} onOpenChange={setOpen} />

      <Dialog open={pending !== undefined} onOpenChange={(next) => !next && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Approve {pending ? periodLabel(pending.year, pending.month) : ""}?
            </DialogTitle>
            <DialogDescription>
              This writes a payslip for everybody with a salary on record and freezes the figures.
              From that moment they are a record of what was decided, not a view over data that can
              still move. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              disabled={approve.isPending}
              onClick={() => {
                if (!pending) return;
                approve.mutate(pending.id, {
                  onSuccess: (result) => {
                    toast.success(`Approved — ${result.payslips} payslips written`);
                    setConfirming(null);
                  },
                  onError: (error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "Could not approve"),
                });
              }}
            >
              {approve.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Approve and write payslips
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OpenMonthDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const periods = recentPeriods();
  const [period, setPeriod] = useState(`${periods[0]!.year}-${periods[0]!.month}`);
  // Base UI reads the trigger's label from here; see the note in preview-tab.
  const periodItems: Record<string, string> = Object.fromEntries(
    periods.map((p) => [`${p.year}-${p.month}`, periodLabel(p.year, p.month)]),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateRun();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open a payroll month</DialogTitle>
          <DialogDescription>
            Attendance for the month has to be locked first. Opening it does not pay anybody — it
            creates the run you then check and approve.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-2">
            <Label htmlFor="run-period">Month</Label>
            <Select
              items={periodItems}
              value={period}
              onValueChange={(value) => setPeriod(value ?? period)}
            >
              <SelectTrigger id="run-period" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                    {periodLabel(p.year, p.month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="run-note">Note (optional)</Label>
            <Input
              id="run-note"
              value={note}
              maxLength={200}
              placeholder="Anything the next person should know"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending}
            onClick={() => {
              setError(null);
              const [year, month] = period.split("-").map(Number);
              create.mutate(
                { year: year!, month: month!, note: note.trim() || null },
                {
                  onSuccess: () => {
                    toast.success("Month opened");
                    setNote("");
                    onOpenChange(false);
                  },
                  onError: (e: unknown) =>
                    setError(e instanceof Error ? e.message : "Could not open the month"),
                },
              );
            }}
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Open month
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
