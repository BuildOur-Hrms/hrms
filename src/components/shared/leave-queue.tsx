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

interface LeaveRequest {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  leaveType: { id: string; name: string; code: string };
  employee: { id: string; firstName: string; lastName: string | null; employeeCode: string };
}

/**
 * The leave approval queue.
 *
 * Only pending requests: a decided one needs no action, and listing them would
 * bury the ones that do. `scope` is "team" for a manager and "all" for HR,
 * which is the only difference between the two screens that use this.
 */
export function LeaveQueue({ scope }: { scope: "team" | "all" }) {
  const queryClient = useQueryClient();
  const [deciding, setDeciding] = useState<{
    row: LeaveRequest;
    decision: "approved" | "rejected";
  } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["leave", "requests", scope, "pending"],
    queryFn: ({ signal }) =>
      api.get<LeaveRequest[]>("/leave/requests", { scope, status: "pending" }, signal),
  });

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Leave to review
          {rows.length > 0 ? (
            <Badge variant="secondary" className="bg-warning/12 text-warning ml-2">
              {rows.length}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Approving deducts the days from their balance. The balance is re-checked at that moment,
          not at the moment they asked.
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
          <EmptyState title="Nothing waiting" description="No leave requests need a decision." />
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
                  <Badge variant="outline" className="text-muted-foreground">
                    {row.leaveType.name}
                  </Badge>
                  <span className="tabular-nums">
                    {row.startDate}
                    {row.endDate !== row.startDate ? ` → ${row.endDate}` : ""}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {row.days} {row.days === 1 ? "day" : "days"}
                  </span>
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
                void queryClient.invalidateQueries({ queryKey: ["leave"] });
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
  row: LeaveRequest;
  decision: "approved" | "rejected";
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/leave/requests/${row.id}/review`, { decision, reviewNote: note || null }),
    onSuccess: () => {
      toast.success(decision === "approved" ? "Leave approved" : "Leave rejected");
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
          {decision === "approved" ? "Approve" : "Reject"} {row.days}{" "}
          {row.days === 1 ? "day" : "days"} of {row.leaveType.name}
        </DialogTitle>
        <DialogDescription>
          {decision === "approved"
            ? "The days come out of their balance now. If the balance has moved since they asked, this will be refused rather than pushed negative."
            : "Their balance is untouched. The request stays on record with your note."}
        </DialogDescription>
      </DialogHeader>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="grid gap-2">
        <Label htmlFor="leave-review-note">
          Note {decision === "rejected" ? "" : "(optional)"}
        </Label>
        <Textarea
          id="leave-review-note"
          rows={3}
          required={decision === "rejected"}
          value={note}
          placeholder={
            decision === "rejected"
              ? "Say why, so they can plan around it."
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
