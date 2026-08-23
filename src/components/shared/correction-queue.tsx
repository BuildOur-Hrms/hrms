"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { fullName } from "@/lib/utils";

interface Correction {
  id: string;
  workDate: string;
  requestedIn: string | null;
  requestedOut: string | null;
  requestedStatus: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  employee: { id: string; firstName: string; lastName: string | null; employeeCode: string };
}

function clock(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "—";
}

/**
 * The approval queue. Only pending requests, because a decided one needs no
 * action and a list of them would bury the ones that do.
 */
export function CorrectionQueue() {
  const queryClient = useQueryClient();
  const [deciding, setDeciding] = useState<{
    row: Correction;
    decision: "approved" | "rejected";
  } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["attendance", "corrections", "team"],
    queryFn: ({ signal }) =>
      api.get<Correction[]>(
        "/attendance/corrections",
        { scope: "team", status: "pending" },
        signal,
      ),
  });

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Corrections to review
          {rows.length > 0 ? (
            <Badge variant="secondary" className="bg-warning/12 text-warning ml-2">
              {rows.length}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Approving adds the requested times as manual punches and recalculates that day.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <EmptyState
            title="Could not load requests"
            description={error instanceof Error ? error.message : undefined}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="No correction requests need a decision."
          />
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <li key={row.id} className="space-y-1.5 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">
                    {fullName(row.employee.firstName, row.employee.lastName)}
                  </span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {row.employee.employeeCode}
                  </span>
                  <span className="tabular-nums">{row.workDate}</span>
                  <div className="ml-auto flex gap-1.5">
                    <Button size="sm" onClick={() => setDeciding({ row, decision: "approved" })}>
                      <Check className="size-4" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeciding({ row, decision: "rejected" })}
                    >
                      <X className="size-4" />
                      Reject
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm">{row.reason}</p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  Asking for: in {clock(row.requestedIn)} · out {clock(row.requestedOut)}
                  {row.requestedStatus ? ` · status ${row.requestedStatus}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!deciding} onOpenChange={(next) => !next && setDeciding(null)}>
        <DialogContent>
          {deciding ? (
            <DecisionForm
              row={deciding.row}
              decision={deciding.decision}
              onDone={() => {
                setDeciding(null);
                void queryClient.invalidateQueries({ queryKey: ["attendance"] });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DecisionForm({
  row,
  decision,
  onDone,
}: {
  row: Correction;
  decision: "approved" | "rejected";
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/attendance/corrections/${row.id}/review`, {
        decision,
        reviewNote: note || null,
      }),
    onSuccess: () => {
      toast.success(decision === "approved" ? "Correction approved" : "Correction rejected");
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
          {decision === "approved" ? "Approve" : "Reject"} correction for {row.workDate}
        </DialogTitle>
        <DialogDescription>
          {decision === "approved"
            ? "The requested times are added as manual punches attributed to you, and the day is recalculated."
            : "The day is left exactly as it is. The request stays on record with your note."}
        </DialogDescription>
      </DialogHeader>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-2">
        <Label htmlFor="review-note">Note {decision === "rejected" ? "" : "(optional)"}</Label>
        <Textarea
          id="review-note"
          rows={3}
          required={decision === "rejected"}
          value={note}
          placeholder={
            decision === "rejected"
              ? "Say why, so they can raise a better one."
              : "Anything worth recording alongside the decision."
          }
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button
          type="submit"
          disabled={submit.isPending}
          variant={decision === "rejected" ? "outline" : "default"}
        >
          {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {decision === "approved" ? "Approve" : "Reject"}
        </Button>
      </DialogFooter>
    </form>
  );
}
