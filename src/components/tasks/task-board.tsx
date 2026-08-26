"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { bandFor, type CompletionBand } from "@/modules/tasks/completion";

import { RankingChart, TrendChart, type RankingRow, type TrendPoint } from "./charts-lazy";

/**
 * Where everybody stands this month.
 *
 * Chart and table both, always: the ranking answers "who needs a conversation"
 * at a glance, and the table is where the exact figures live for anyone who has
 * to act on one. A chart alone would make a tooltip the only way to read a
 * number somebody is being judged on.
 */

interface Slice {
  percent: number;
  total: number;
  completed: number;
}

interface BoardRow {
  employee: {
    id: string;
    firstName: string;
    lastName: string | null;
    employeeCode: string;
    department: string | null;
  };
  completion: { assigned: Slice; self: Slice; overall: Slice };
  headline: { percent: number; basis: "assigned" | "self" | null };
}

interface Board {
  rows: BoardRow[];
  trend: TrendPoint[];
  completion: { assigned: Slice; self: Slice; overall: Slice };
  withTasks: number;
}

interface Department {
  id: string;
  name: string;
}

const ALL = "__all__";

/**
 * Colour is not carrying this on its own: the band is written out beside it.
 * Status tokens, not the series palette — these mean a state, not an identity.
 */
const BAND_STYLE: Record<CompletionBand, { label: string; className: string }> = {
  ahead: { label: "Ahead", className: "bg-success/12 text-success" },
  "on-track": { label: "On track", className: "bg-info/12 text-info" },
  behind: { label: "Behind", className: "bg-warning/12 text-warning" },
  "at-risk": { label: "At risk", className: "bg-destructive/10 text-destructive" },
};

function thisMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function monthValue({ year, month }: { year: number; month: number }): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function fullName(row: BoardRow): string {
  return [row.employee.firstName, row.employee.lastName].filter(Boolean).join(" ");
}

export function TaskBoard({ scope, canAssign }: { scope: "team" | "all"; canAssign: boolean }) {
  const [period, setPeriod] = useState(thisMonth);
  const [departmentId, setDepartmentId] = useState(ALL);
  const [assigning, setAssigning] = useState<BoardRow | null>(null);
  const queryClient = useQueryClient();

  const params = {
    year: period.year,
    month: period.month,
    scope,
    months: 6,
    ...(departmentId !== ALL ? { departmentId } : {}),
  };

  const board = useQuery({
    queryKey: ["tasks", "board", params],
    queryFn: ({ signal }) => api.get<Board>("/tasks/board", params, signal),
    placeholderData: keepPreviousData,
  });

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: ({ signal }) => api.get<Department[]>("/departments", undefined, signal),
    enabled: scope === "all",
  });

  const data = board.data;
  // Sorted by the figure that counts, so the chart answers the question people
  // open it with: who is behind.
  const sorted = [...(data?.rows ?? [])].sort(
    (a, b) => b.completion.assigned.percent - a.completion.assigned.percent,
  );

  const ranking: RankingRow[] = sorted
    .filter((row) => row.headline.basis !== null)
    .map((row) => ({
      id: row.employee.id,
      name: fullName(row),
      assigned: row.completion.assigned.percent,
      self: row.completion.self.percent,
      taskCount: row.completion.overall.total,
    }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="board-month">Month</Label>
          <Input
            id="board-month"
            type="month"
            className="w-44"
            value={monthValue(period)}
            onChange={(event) => {
              const [year, month] = event.target.value.split("-");
              if (year && month) setPeriod({ year: Number(year), month: Number(month) });
            }}
          />
        </div>

        {scope === "all" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="board-department">Department</Label>
            <Select
              items={Object.fromEntries([
                [ALL, "Everyone"],
                ...(departments.data ?? []).map((d) => [d.id, d.name]),
              ])}
              value={departmentId}
              onValueChange={(value) => setDepartmentId(value ?? ALL)}
            >
              <SelectTrigger id="board-department" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Everyone</SelectItem>
                {(departments.data ?? []).map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {board.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : !data ? (
        <EmptyState icon={BarChart3} title="Could not load the board" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Assigned work done"
              value={`${data.completion.assigned.percent}%`}
              hint="weighted, everyone shown"
            />
            <StatCard label="People shown" value={data.rows.length} />
            <StatCard
              label="With tasks this month"
              value={data.withTasks}
              // An average over four people out of forty is not an average of
              // the company, and the screen should not let anyone forget it.
              hint={
                data.withTasks < data.rows.length
                  ? `${data.rows.length - data.withTasks} have none set`
                  : "everyone has something set"
              }
            />
            <StatCard label="Tasks completed" value={data.completion.overall.completed} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>This month, by person</CardTitle>
              </CardHeader>
              <CardContent>
                {ranking.length === 0 ? (
                  <EmptyState
                    icon={BarChart3}
                    title="Nobody has tasks for this month"
                    description="Set someone a task and it will show up here."
                  />
                ) : (
                  <RankingChart rows={ranking} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>The last six months</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart data={data.trend} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Everyone</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-card overflow-x-auto rounded-xl border shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead>Self-added</TableHead>
                      <TableHead>Done</TableHead>
                      <TableHead>Standing</TableHead>
                      {canAssign ? <TableHead className="w-24" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((row) => {
                      const band = BAND_STYLE[bandFor(row.headline.percent)];
                      const hasTasks = row.headline.basis !== null;
                      return (
                        <TableRow key={row.employee.id}>
                          <TableCell>
                            <span className="font-medium">{fullName(row)}</span>
                            <span className="text-muted-foreground block font-mono text-xs">
                              {row.employee.employeeCode}
                            </span>
                          </TableCell>
                          <TableCell>{row.employee.department ?? "—"}</TableCell>
                          <TableCell className="tabular-nums">
                            {row.completion.assigned.total > 0
                              ? `${row.completion.assigned.percent}%`
                              : "—"}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {row.completion.self.total > 0
                              ? `${row.completion.self.percent}%`
                              : "—"}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {row.completion.overall.completed}/{row.completion.overall.total}
                          </TableCell>
                          <TableCell>
                            {hasTasks ? (
                              <Badge variant="secondary" className={band.className}>
                                {band.label}
                              </Badge>
                            ) : (
                              // Not the same as zero, and saying so is the point.
                              <span className="text-muted-foreground text-xs">Nothing set</span>
                            )}
                          </TableCell>
                          {canAssign ? (
                            <TableCell>
                              <Button variant="ghost" size="xs" onClick={() => setAssigning(row)}>
                                <Plus className="size-4" />
                                Assign
                              </Button>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <AssignDialog
        row={assigning}
        period={period}
        onClose={() => setAssigning(null)}
        onAssigned={() => queryClient.invalidateQueries({ queryKey: ["tasks"] })}
      />
    </div>
  );
}

function AssignDialog({
  row,
  period,
  onClose,
  onAssigned,
}: {
  row: BoardRow | null;
  period: { year: number; month: number };
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("1");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setWeight("1");
    setDueDate("");
    setError(null);
  }

  const submit = useMutation({
    mutationFn: () =>
      api.post("/tasks", {
        employeeId: row!.employee.id,
        title,
        description: description || null,
        weight: Number(weight),
        dueDate: dueDate || null,
        year: period.year,
        month: period.month,
      }),
    onSuccess: () => {
      toast.success("Task assigned");
      reset();
      onAssigned();
      onClose();
    },
    onError: (error: unknown) =>
      setError(error instanceof Error ? error.message : "Could not assign it"),
  });

  return (
    <Dialog
      open={row !== null}
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
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            submit.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Assign a task to {row ? fullName(row) : ""}</DialogTitle>
            <DialogDescription>
              Counted towards their assigned figure for {monthValue(period)}. They can move it along
              but not change it.
            </DialogDescription>
          </DialogHeader>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="grid gap-2">
            <Label htmlFor="assign-title">What is it</Label>
            <Input
              id="assign-title"
              required
              minLength={3}
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="assign-notes">Notes</Label>
            <Textarea
              id="assign-notes"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="assign-weight">How much it counts</Label>
              <Input
                id="assign-weight"
                type="number"
                min={1}
                max={100}
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="assign-due">Due</Label>
              <Input
                id="assign-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submit.isPending || title.trim().length < 3}>
              {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Assign it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
