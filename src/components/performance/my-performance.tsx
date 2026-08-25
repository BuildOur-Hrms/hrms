"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  CYCLE_LABEL,
  CYCLE_TINT,
  GoalList,
  GoalProgress,
  RatingBadge,
  RatingPicker,
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
import { Textarea } from "@/components/ui/textarea";
import {
  useAddGoal,
  useCycles,
  useGoals,
  useReviewStep,
  useReviews,
  type Cycle,
} from "@/hooks/use-performance";
import type { Rating } from "@/modules/performance/rules";

/**
 * Performance, from the employee's own side.
 *
 * One cycle at a time — whichever is open — because a person has one set of
 * goals and one review in flight, and a list of past cycles is a different
 * question from "what am I being asked for".
 */
export function MyPerformance() {
  const cycles = useCycles();
  const reviews = useReviews({ mine: true });

  if (cycles.isLoading) return <Skeleton className="h-64 w-full" />;

  const open = (cycles.data ?? []).find(
    (cycle) => cycle.status === "active" || cycle.status === "review",
  );

  if (!open) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nothing open</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No cycle is running"
            description="Goals and reviews appear here when HR opens a review cycle."
          />
        </CardContent>
      </Card>
    );
  }

  const review = (reviews.data ?? []).find((row) => row.cycleId === open.id);

  return (
    <div className="space-y-4">
      <MyGoals cycle={open} />
      {review ? <MyReview review={review} /> : null}
    </div>
  );
}

function MyGoals({ cycle }: { cycle: Cycle }) {
  const goals = useGoals(cycle.id);
  const [adding, setAdding] = useState(false);

  const canAdd = cycle.status === "active" || cycle.status === "draft";

  return (
    <Card>
      {/* `flex` explicitly: CardHeader lays out as a grid, and flex-row alone
          leaves the button stretched across its own row. */}
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            My goals
            <Badge variant="secondary" className={CYCLE_TINT[cycle.status]}>
              {cycle.name} · {CYCLE_LABEL[cycle.status]}
            </Badge>
          </CardTitle>
          <CardDescription>
            {cycle.periodStart.slice(0, 10)} to {cycle.periodEnd.slice(0, 10)}.
            {goals.data?.approved
              ? " Your manager has agreed these."
              : " Your manager agrees them as a set."}
          </CardDescription>
        </div>
        {canAdd ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add a goal
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {goals.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            {goals.data && goals.data.goals.length > 0 ? (
              <GoalProgress percent={goals.data.progress} />
            ) : null}
            <GoalList
              goals={goals.data?.goals ?? []}
              emptyMessage={
                canAdd
                  ? "Nothing yet. Add what you are working towards this cycle."
                  : "No goals were set for this cycle."
              }
            />
            {canAdd ? null : (
              <p className="text-muted-foreground text-xs">
                Goals are closed for this cycle — adding one now would change what you are being
                reviewed against.
              </p>
            )}
          </>
        )}
      </CardContent>

      <AddGoalDialog cycleId={cycle.id} open={adding} onOpenChange={setAdding} />
    </Card>
  );
}

function AddGoalDialog({
  cycleId,
  open,
  onOpenChange,
}: {
  cycleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const add = useAddGoal(cycleId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("1");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a goal</DialogTitle>
          <DialogDescription>
            Weight is relative — a goal weighted 3 counts for three times as much as one weighted 1.
            Nothing has to add up to a hundred.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="goal-title">What are you working towards?</Label>
            <Input
              id="goal-title"
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ship the reporting rewrite"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="goal-description">Anything worth spelling out</Label>
            <Textarea
              id="goal-description"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="goal-weight">Weight</Label>
            <Input
              id="goal-weight"
              type="number"
              min={1}
              max={100}
              className="w-28"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={title.trim().length === 0 || add.isPending}
            onClick={() =>
              add.mutate(
                {
                  title: title.trim(),
                  description: description.trim() || null,
                  weight: Number(weight) || 1,
                },
                {
                  onSuccess: () => {
                    toast.success("Goal added");
                    setTitle("");
                    setDescription("");
                    setWeight("1");
                    onOpenChange(false);
                  },
                  onError: (error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "Could not add it"),
                },
              )
            }
          >
            {add.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Add it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MyReview({ review }: { review: import("@/hooks/use-performance").Review }) {
  const step = useReviewStep();
  const [rating, setRating] = useState<Rating | null>(null);
  const [comments, setComments] = useState("");

  const mine = review.status === "pending_self";

  return (
    <Card>
      <CardHeader>
        <CardTitle>My review</CardTitle>
        <CardDescription>
          {mine
            ? "Your half first. Your manager writes theirs once yours is in."
            : "Your half is in."}
          {review.cycle.reviewDeadline
            ? ` Due by ${review.cycle.reviewDeadline.slice(0, 10)}.`
            : ""}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {mine ? (
          <>
            <div className="grid gap-2">
              <Label>How did the cycle go?</Label>
              <RatingPicker
                idPrefix="self-rating"
                value={rating}
                onChange={setRating}
                disabled={step.isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="self-comments">In your own words</Label>
              <Textarea
                id="self-comments"
                rows={5}
                maxLength={4000}
                value={comments}
                onChange={(event) => setComments(event.target.value)}
                placeholder="What went well, what did not, and what you want next."
              />
            </div>

            <Button
              disabled={rating === null || comments.trim().length === 0 || step.isPending}
              onClick={() =>
                step.mutate(
                  { id: review.id, step: "self", body: { rating, comments: comments.trim() } },
                  {
                    onSuccess: () => toast.success("Sent to your manager"),
                    onError: (error: unknown) =>
                      toast.error(error instanceof Error ? error.message : "Could not submit it"),
                  },
                )
              }
            >
              {step.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Submit my review
            </Button>

            <p className="text-muted-foreground text-xs">
              Once submitted this cannot be edited. Ask HR if something needs changing.
            </p>
          </>
        ) : (
          <div className="space-y-3">
            <RatingBadge value={review.selfRating} label="You said" />
            {review.selfComments ? <p className="text-sm">{review.selfComments}</p> : null}

            {review.status === "completed" ? (
              <div className="space-y-3 border-t pt-3">
                <RatingBadge value={review.managerRating} label="Your manager said" />
                {review.managerComments ? (
                  <p className="text-sm">{review.managerComments}</p>
                ) : null}
                <RatingBadge value={review.finalRating} label="Final" />
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Waiting on your manager. You will see their half once the review is complete.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
