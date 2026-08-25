"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  CYCLE_LABEL,
  CYCLE_TINT,
  RATING_LABEL,
  REVIEW_LABEL,
  REVIEW_TINT,
} from "@/components/performance/parts";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateCycle,
  useCycleStatus,
  useCycleSummary,
  useCycles,
  useReviews,
  type Cycle,
  type CycleStatus,
} from "@/hooks/use-performance";
import { RATINGS, type Rating } from "@/modules/performance/rules";

/**
 * Performance, from HR's side.
 *
 * A cycle at a time, because a company runs one at a time and a list of every
 * cycle ever is a filing cabinet rather than a screen. Picking an old one
 * shows what it settled on.
 */

/**
 * What the next step does, phrased as the step rather than as a state.
 *
 * "Ratings are settled and locked" reads as a description of now; it is
 * actually what closing the cycle would do, which is the opposite of what
 * somebody about to press the button needs to know.
 */
const NEXT_LABEL: Partial<Record<CycleStatus, { to: CycleStatus; label: string; note: string }>> = {
  draft: {
    to: "active",
    label: "Open for goals",
    note: "Opening it lets people set goals and managers agree them.",
  },
  active: {
    to: "review",
    label: "Open reviews",
    note: "Opening reviews closes goals and creates a review for everybody.",
  },
  review: {
    to: "closed",
    label: "Close the cycle",
    note: "Closing settles the ratings and locks them.",
  },
};

export function PerformanceWorkspace({ canManage }: { canManage: boolean }) {
  const cycles = useCycles();
  const [chosen, setChosen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (cycles.isLoading) return <Skeleton className="h-64 w-full" />;

  const rows = cycles.data ?? [];
  const current =
    rows.find((cycle) => cycle.id === chosen) ??
    rows.find((cycle) => cycle.status === "review") ??
    rows.find((cycle) => cycle.status === "active") ??
    rows[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Cycles</CardTitle>
            <CardDescription>A review period, its goals and its reviews.</CardDescription>
          </div>
          {canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New cycle
            </Button>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-2">
          {rows.length === 0 ? (
            <EmptyState
              title="No cycles yet"
              description="A cycle is a period — H1 2027, say — with goals and reviews inside it."
            />
          ) : (
            rows.map((cycle) => (
              <button
                key={cycle.id}
                type="button"
                onClick={() => setChosen(cycle.id)}
                className={
                  cycle.id === current?.id
                    ? "border-brand bg-brand-soft/30 w-full rounded-lg border p-3 text-left"
                    : "hover:bg-muted w-full rounded-lg border p-3 text-left transition-colors"
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{cycle.name}</span>
                  <Badge variant="secondary" className={CYCLE_TINT[cycle.status]}>
                    {CYCLE_LABEL[cycle.status]}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  {cycle.periodStart.slice(0, 10)} to {cycle.periodEnd.slice(0, 10)}
                  {cycle.reviewDeadline
                    ? ` · reviews due ${cycle.reviewDeadline.slice(0, 10)}`
                    : ""}
                </p>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {current ? <CycleDetail cycle={current} canManage={canManage} /> : null}

      <NewCycleDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function CycleDetail({ cycle, canManage }: { cycle: Cycle; canManage: boolean }) {
  const summary = useCycleSummary(cycle.id);
  const reviews = useReviews({ cycleId: cycle.id });
  const move = useCycleStatus(cycle.id);

  const next = NEXT_LABEL[cycle.status];
  const tally = summary.data?.tally;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{cycle.name}</CardTitle>
            <CardDescription>{next ? next.note : "This cycle is finished."}</CardDescription>
          </div>
          {canManage && next ? (
            <Button
              size="sm"
              disabled={move.isPending}
              onClick={() =>
                move.mutate(next.to, {
                  onSuccess: (result) =>
                    toast.success(
                      result.opened > 0
                        ? `${result.opened} review${result.opened === 1 ? "" : "s"} opened`
                        : "Done",
                    ),
                  onError: (error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "Could not do that"),
                })
              }
            >
              {move.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {next.label}
            </Button>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-5">
          {summary.isLoading || !tally ? (
            <Skeleton className="h-24 w-full" />
          ) : tally.total === 0 ? (
            <p className="text-muted-foreground text-sm">
              No reviews yet — they are created when the cycle opens for reviews.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label="Reviews" value={tally.total} />
                <Figure label="Waiting on them" value={tally.awaitingSelf} />
                <Figure label="Waiting on managers" value={tally.awaitingManager} />
                <Figure label="Done" value={tally.completed} />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium">How the ratings fell</h3>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {tally.averageFinal === null
                      ? "nothing rated yet"
                      : `average ${tally.averageFinal}`}
                  </span>
                </div>
                <Distribution distribution={tally.distribution} rated={tally.rated} />
                <p className="text-muted-foreground text-xs">
                  {/*
                    The shape, not the average. A department where everybody
                    scored 4 has not been calibrated, and a mean of 4.0 looks
                    perfectly healthy.
                  */}
                  A cycle where everyone lands on the same rung has not been calibrated, which the
                  average alone will not show you.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Everybody in this cycle</CardTitle>
        </CardHeader>
        <CardContent>
          {reviews.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (reviews.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing to show yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Self</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead>Final</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(reviews.data ?? []).map((review) => (
                    <TableRow key={review.id}>
                      <TableCell>
                        <span className="font-medium">
                          {[review.employee.firstName, review.employee.lastName]
                            .filter(Boolean)
                            .join(" ")}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {review.employee.department?.name ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={REVIEW_TINT[review.status]}>
                          {REVIEW_LABEL[review.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">{review.selfRating ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{review.managerRating ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{review.finalRating ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

/**
 * The spread of final ratings.
 *
 * Bars rather than a chart library: five numbers do not need one, and a
 * distribution somebody has to hover to read is a distribution nobody reads.
 */
function Distribution({
  distribution,
  rated,
}: {
  distribution: Record<string, number>;
  rated: number;
}) {
  const most = Math.max(1, ...RATINGS.map((rating) => distribution[String(rating)] ?? 0));

  return (
    <div className="space-y-1.5">
      {RATINGS.map((rating) => {
        const count = distribution[String(rating)] ?? 0;
        return (
          <div key={rating} className="flex items-center gap-3">
            <span className="text-muted-foreground w-32 shrink-0 text-xs">
              {rating} · {RATING_LABEL[rating as Rating]}
            </span>
            <div className="bg-muted h-3 flex-1 overflow-hidden rounded">
              <div className="bg-brand h-full" style={{ width: `${(count / most) * 100}%` }} />
            </div>
            <span className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums">
              {count}
              {rated > 0 ? ` · ${Math.round((count / rated) * 100)}%` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NewCycleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateCycle();
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [deadline, setDeadline] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New cycle</DialogTitle>
          <DialogDescription>
            A period people are reviewed over. It starts as a draft — nothing happens until you open
            it for goals.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="cycle-name">Name</Label>
            <Input
              id="cycle-name"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="H1 2027"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="cycle-start">Period starts</Label>
              <Input
                id="cycle-start"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cycle-end">Period ends</Label>
              <Input
                id="cycle-end"
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cycle-deadline">Reviews due by</Label>
            <Input
              id="cycle-deadline"
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">Optional.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={name.trim().length === 0 || !start || !end || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  name: name.trim(),
                  periodStart: start,
                  periodEnd: end,
                  reviewDeadline: deadline || null,
                },
                {
                  onSuccess: () => {
                    toast.success("Cycle created");
                    setName("");
                    setStart("");
                    setEnd("");
                    setDeadline("");
                    onOpenChange(false);
                  },
                  onError: (error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "Could not create it"),
                },
              )
            }
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Create it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
