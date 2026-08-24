"use client";

import { AlertTriangle, Check, Loader2, SkipForward } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSettleTask, type ChecklistTask, type ChecklistProgress } from "@/hooks/use-checklists";

/**
 * A checklist, and the things left to do on it.
 *
 * The same panel serves the employee record, the pipeline and the new
 * joiner's own page, because all three are asking one question: what is left,
 * and who is it waiting on.
 *
 * Skipping is offered beside completing rather than hidden behind a menu. A
 * task that does not apply is a normal outcome — a joiner who brings their
 * own laptop — and burying the option is how checklists end up full of things
 * marked done that were not done.
 */

const ROLE_LABEL: Record<string, string> = {
  hr: "HR",
  it: "IT",
  manager: "Manager",
  employee: "Them",
};

export function ProgressBar({ progress }: { progress: ChecklistProgress }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="bg-muted h-1.5 w-full max-w-48 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Checklist progress"
      >
        <div
          className={progress.blocking === 0 ? "bg-success h-full" : "bg-brand h-full"}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">
        {progress.done} of {progress.total}
      </span>
      {progress.overdue > 0 ? (
        <Badge variant="secondary" className="bg-warning/12 text-warning">
          <AlertTriangle className="size-3" />
          {progress.overdue} overdue
        </Badge>
      ) : null}
    </div>
  );
}

export function ChecklistPanel({
  tasks,
  progress,
  today,
  canSettle = true,
  emptyMessage = "Nothing on this checklist yet.",
}: {
  tasks: ChecklistTask[];
  /**
   * Omitted where the caller holds only part of a checklist.
   *
   * A bar drawn from the outstanding tasks alone would read 0% however much
   * somebody had already done, which is worse than no bar.
   */
  progress?: ChecklistProgress | undefined;
  /** Passed in rather than read here, so the server and the browser agree. */
  today: string;
  canSettle?: boolean;
  emptyMessage?: string;
}) {
  const [skipping, setSkipping] = useState<ChecklistTask | null>(null);
  const [reason, setReason] = useState("");
  const settle = useSettleTask();

  if (tasks.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  function complete(task: ChecklistTask) {
    settle.mutate(
      { id: task.id, status: "completed" },
      {
        onSuccess: () => toast.success(`${task.title} — done`),
        onError: (error: unknown) =>
          toast.error(error instanceof Error ? error.message : "Could not update the task"),
      },
    );
  }

  return (
    <div className="space-y-4">
      {progress ? <ProgressBar progress={progress} /> : null}

      <ul className="divide-border divide-y border-y">
        {tasks.map((task) => {
          const overdue =
            task.status === "pending" && task.dueDate !== null && task.dueDate < today;

          return (
            <li key={task.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      task.status === "pending"
                        ? "font-medium"
                        : "text-muted-foreground font-medium line-through"
                    }
                  >
                    {task.title}
                  </span>
                  {task.isRequired ? null : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Optional
                    </Badge>
                  )}
                  {overdue ? (
                    <Badge variant="secondary" className="bg-warning/12 text-warning">
                      Overdue
                    </Badge>
                  ) : null}
                  {task.status === "skipped" ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      Skipped
                    </Badge>
                  ) : null}
                </div>

                {task.description ? (
                  <p className="text-muted-foreground text-sm">{task.description}</p>
                ) : null}

                <p className="text-muted-foreground text-xs">
                  {ROLE_LABEL[task.assignee] ?? task.assignee}
                  {task.assignedTo
                    ? ` · ${[task.assignedTo.firstName, task.assignedTo.lastName]
                        .filter(Boolean)
                        .join(" ")}`
                    : " · nobody assigned"}
                  {task.dueDate ? ` · due ${task.dueDate}` : ""}
                </p>

                {task.skipReason ? (
                  <p className="text-muted-foreground text-xs italic">{task.skipReason}</p>
                ) : null}
              </div>

              {canSettle && task.status === "pending" ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={settle.isPending}
                    onClick={() => complete(task)}
                  >
                    {settle.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    Done
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={settle.isPending}
                    onClick={() => {
                      setReason("");
                      setSkipping(task);
                    }}
                  >
                    <SkipForward className="size-3.5" />
                    Skip
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Dialog open={skipping !== null} onOpenChange={(next) => !next && setSkipping(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skip “{skipping?.title}”?</DialogTitle>
            <DialogDescription>
              It stays on the checklist with your reason against it, and stops holding anything up.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="skip-reason">Why is it being skipped?</Label>
            <Textarea
              id="skip-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="They are bringing their own machine."
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSkipping(null)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length === 0 || settle.isPending}
              onClick={() => {
                if (!skipping) return;
                settle.mutate(
                  { id: skipping.id, status: "skipped", skipReason: reason.trim() },
                  {
                    onSuccess: () => {
                      toast.success("Skipped");
                      setSkipping(null);
                    },
                    onError: (error: unknown) =>
                      toast.error(
                        error instanceof Error ? error.message : "Could not skip the task",
                      ),
                  },
                );
              }}
            >
              {settle.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Skip it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
