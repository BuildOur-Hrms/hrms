"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { api } from "@/lib/api-client";

import { SERIES } from "./chart-parts";
import { TrendChart, type TrendPoint } from "./trend-chart";

/**
 * What I am meant to be doing this month, and how far along it is.
 *
 * The screen answers three questions in the order somebody actually asks them:
 * where am I, what is left, and how did the last few months go.
 */

interface Task {
  id: string;
  origin: "assigned" | "self";
  title: string;
  description: string | null;
  weight: number;
  progress: number;
  status: "not_started" | "in_progress" | "completed" | "cancelled";
  dueDate: string | null;
}

interface Slice {
  percent: number;
  total: number;
  completed: number;
}

interface TaskMonth {
  tasks: Task[];
  completion: { assigned: Slice; self: Slice; overall: Slice };
  headline: { percent: number; basis: "assigned" | "self" | null };
}

function thisMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function monthValue({ year, month }: { year: number; month: number }): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function MyTasks() {
  const [period, setPeriod] = useState(thisMonth);
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();

  const month = useQuery({
    queryKey: ["tasks", "mine", period],
    queryFn: ({ signal }) =>
      api.get<TaskMonth>("/tasks", { year: period.year, month: period.month }, signal),
    placeholderData: keepPreviousData,
  });

  const trend = useQuery({
    queryKey: ["tasks", "trend", period],
    queryFn: ({ signal }) =>
      api.get<TrendPoint[]>(
        "/tasks/trend",
        { year: period.year, month: period.month, months: 6 },
        signal,
      ),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });

  const data = month.data;
  const assigned = data?.tasks.filter((task) => task.origin === "assigned") ?? [];
  const own = data?.tasks.filter((task) => task.origin === "self") ?? [];

  return (
    <div className="space-y-4">
      {/* One filter row, above everything it scopes. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="task-month">Month</Label>
          <Input
            id="task-month"
            type="month"
            className="w-44"
            value={monthValue(period)}
            onChange={(event) => {
              const [year, month] = event.target.value.split("-");
              if (year && month) setPeriod({ year: Number(year), month: Number(month) });
            }}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Add my own task
        </Button>
      </div>

      {month.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Card>
            <CardHeader>
              <CardTitle>This month</CardTitle>
            </CardHeader>
            <CardContent>
              <Headline data={data} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>The last six months</CardTitle>
            </CardHeader>
            <CardContent>
              {trend.data && trend.data.length > 0 ? (
                <TrendChart data={trend.data} />
              ) : (
                <Skeleton className="h-52 w-full" />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <TaskList
        title="Set for me"
        description="Weighted by how much each one counts. You can move these along, but not change them."
        tasks={assigned}
        canRemove={false}
        onChanged={refresh}
      />
      <TaskList
        title="Added by me"
        description="Your own. They are shown separately and never counted towards the assigned figure."
        tasks={own}
        canRemove
        onChanged={refresh}
      />

      <AddTaskDialog
        open={adding}
        period={period}
        onClose={() => setAdding(false)}
        onAdded={refresh}
      />
    </div>
  );
}

/**
 * The hero figure.
 *
 * Proportional figures rather than `tabular-nums` — equal-width digits make a
 * standalone number look loose at this size, and nothing is aligned under it.
 */
function Headline({ data }: { data: TaskMonth | undefined }) {
  if (!data || data.headline.basis === null) {
    return (
      <div className="py-6">
        <p className="text-muted-foreground text-sm">
          Nothing on your list for this month yet. Anything your manager sets will appear here.
        </p>
      </div>
    );
  }

  const { assigned, self } = data.completion;
  const basisIsAssigned = data.headline.basis === "assigned";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-4xl leading-none font-semibold">{data.headline.percent}%</p>
        <p className="text-muted-foreground mt-2 text-sm">
          of {basisIsAssigned ? "the work set for you" : "the tasks you set yourself"}, weighted
        </p>
      </div>

      <dl className="space-y-2 text-sm">
        <Split slice={assigned} label={SERIES.assigned.label} color={SERIES.assigned.color} />
        <Split slice={self} label={SERIES.self.label} color={SERIES.self.color} />
      </dl>
    </div>
  );
}

function Split({ slice, label, color }: { slice: Slice; label: string; color: string }) {
  if (slice.total === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto tabular-nums">
        <span className="font-medium">{slice.percent}%</span>
        <span className="text-muted-foreground ml-2">
          {slice.completed}/{slice.total} done
        </span>
      </dd>
    </div>
  );
}

function TaskList({
  title,
  description,
  tasks,
  canRemove,
  onChanged,
}: {
  title: string;
  description: string;
  tasks: Task[];
  canRemove: boolean;
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-muted-foreground text-sm">{description}</p>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <EmptyState icon={ListChecks} title="Nothing here for this month" />
        ) : (
          <ul className="divide-border divide-y">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} canRemove={canRemove} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const STEPS = [0, 25, 50, 75, 100];

function TaskRow({
  task,
  canRemove,
  onChanged,
}: {
  task: Task;
  canRemove: boolean;
  onChanged: () => void;
}) {
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/tasks/${task.id}`, body),
    onSuccess: onChanged,
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Could not save"),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/tasks/${task.id}`),
    onSuccess: () => {
      toast.success("Task removed");
      onChanged();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Could not remove"),
  });

  const done = task.status === "completed";

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`font-medium ${done ? "text-muted-foreground line-through" : ""}`}>
          {task.title}
        </span>
        {task.weight > 1 ? (
          <Badge variant="outline" className="text-muted-foreground">
            counts {task.weight}&times;
          </Badge>
        ) : null}
        {task.dueDate ? (
          <span className="text-muted-foreground text-xs tabular-nums">due {task.dueDate}</span>
        ) : null}
        <span className="ml-auto text-sm font-medium tabular-nums">{task.progress}%</span>
      </div>

      {task.description ? (
        <p className="text-muted-foreground text-sm">{task.description}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((step) => (
          <Button
            key={step}
            size="xs"
            variant={task.progress === step ? "default" : "outline"}
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                step === 100
                  ? { status: "completed" }
                  : { progress: step, status: step === 0 ? "not_started" : "in_progress" },
              )
            }
          >
            {step}%
          </Button>
        ))}
        {save.isPending ? <Loader2 className="text-muted-foreground size-4 animate-spin" /> : null}

        {canRemove ? (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 className="size-4" />
            Remove
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function AddTaskDialog({
  open,
  period,
  onClose,
  onAdded,
}: {
  open: boolean;
  period: { year: number; month: number };
  onClose: () => void;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.post("/tasks", {
        title,
        description: description || null,
        weight: Number(weight),
        year: period.year,
        month: period.month,
      }),
    onSuccess: () => {
      toast.success("Task added");
      setTitle("");
      setDescription("");
      setWeight("1");
      setError(null);
      onAdded();
      onClose();
    },
    onError: (error: unknown) =>
      setError(error instanceof Error ? error.message : "Could not add it"),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            submit.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a task for yourself</DialogTitle>
            <DialogDescription>
              Kept separate from the work set for you, and never counted towards that figure.
            </DialogDescription>
          </DialogHeader>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-2">
            <Label htmlFor="task-title">What is it</Label>
            <Input
              id="task-title"
              required
              minLength={3}
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-notes">Notes</Label>
            <Textarea
              id="task-notes"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-weight">How much it counts</Label>
            <Input
              id="task-weight"
              type="number"
              min={1}
              max={100}
              className="w-28"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Relative to your other tasks. A 3 counts for three times as much as a 1.
            </p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submit.isPending || title.trim().length < 3}>
              {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Add it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
