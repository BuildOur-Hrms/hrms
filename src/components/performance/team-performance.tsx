"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  GoalList,
  GoalProgress,
  RATING_LABEL,
  RatingBadge,
  RatingPicker,
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useApproveGoals, useReview, useReviewStep, useReviews } from "@/hooks/use-performance";
import type { Rating } from "@/modules/performance/rules";

/**
 * Performance, from a manager's side: the reviews they owe.
 *
 * Ordered by who is waiting on them rather than by name, because the only
 * question this screen answers is "what have I not done yet".
 */
export function TeamPerformance() {
  const reviews = useReviews({ toWrite: true });
  const [writing, setWriting] = useState<string | null>(null);

  if (reviews.isLoading) return <Skeleton className="h-64 w-full" />;

  const rows = reviews.data ?? [];
  const waiting = rows.filter((row) => row.status === "pending_manager");
  const rest = rows.filter((row) => row.status !== "pending_manager");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Reviews you owe</CardTitle>
          <CardDescription>
            Your reports, once each of them has written their own half.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 ? (
            <EmptyState
              title="Nothing to write"
              description="Reviews appear here when HR opens a cycle and your reports submit theirs."
            />
          ) : (
            [...waiting, ...rest].map((review) => (
              <div
                key={review.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {[review.employee.firstName, review.employee.lastName]
                        .filter(Boolean)
                        .join(" ")}
                    </span>
                    <Badge variant="secondary" className={REVIEW_TINT[review.status]}>
                      {REVIEW_LABEL[review.status]}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {review.cycle.name}
                    {review.employee.designation ? ` · ${review.employee.designation.title}` : ""}
                    {review.finalRating
                      ? ` · rated ${review.finalRating} · ${RATING_LABEL[review.finalRating as Rating] ?? ""}`
                      : ""}
                  </p>
                </div>

                <Button
                  size="xs"
                  variant={review.status === "pending_manager" ? "default" : "outline"}
                  onClick={() => setWriting(review.id)}
                >
                  {review.status === "pending_manager" ? "Write it" : "Open"}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {writing ? <ReviewDialog id={writing} onClose={() => setWriting(null)} /> : null}
    </div>
  );
}

/**
 * One review, with the goals it is judged against.
 *
 * The goals and the person's own words are on the same screen as the rating
 * box on purpose: a manager rating somebody without their goal set in front
 * of them is rating a memory.
 */
function ReviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const review = useReview(id);
  const step = useReviewStep();
  const approve = useApproveGoals(review.data?.cycleId ?? "");

  const [rating, setRating] = useState<Rating | null>(null);
  const [comments, setComments] = useState("");

  const data = review.data;
  const writing = data?.status === "pending_manager";
  const name = data
    ? [data.employee.firstName, data.employee.lastName].filter(Boolean).join(" ")
    : "";

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{name || "Review"}</DialogTitle>
          <DialogDescription>{data ? data.cycle.name : ""}</DialogDescription>
        </DialogHeader>

        {review.isLoading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Their goals</h3>
                {data.goals.length > 0 && !data.approved ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={approve.isPending}
                    onClick={() =>
                      approve.mutate(data.employeeId, {
                        onSuccess: () => toast.success("Goals agreed"),
                        onError: (error: unknown) =>
                          toast.error(
                            error instanceof Error ? error.message : "Could not agree them",
                          ),
                      })
                    }
                  >
                    {approve.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Agree the set
                  </Button>
                ) : null}
              </div>
              {data.goals.length > 0 ? <GoalProgress percent={data.progress} /> : null}
              <GoalList goals={data.goals} emptyMessage="They set no goals for this cycle." />
            </section>

            <section className="space-y-2 border-t pt-4">
              <h3 className="font-medium">What they said</h3>
              <RatingBadge value={data.selfRating} label="They rated themselves" />
              {data.selfComments ? (
                <p className="text-sm whitespace-pre-wrap">{data.selfComments}</p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  They have not written their half yet, so there is nothing to review against.
                </p>
              )}
            </section>

            <section className="space-y-3 border-t pt-4">
              <h3 className="font-medium">Your half</h3>

              {writing ? (
                <>
                  <RatingPicker
                    idPrefix="manager-rating"
                    value={rating}
                    onChange={setRating}
                    disabled={step.isPending}
                  />

                  <div className="grid gap-2">
                    <Label htmlFor="manager-comments">Your assessment</Label>
                    <Textarea
                      id="manager-comments"
                      rows={5}
                      maxLength={4000}
                      value={comments}
                      onChange={(event) => setComments(event.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <RatingBadge value={data.managerRating} label="You rated" />
                  {data.managerComments ? (
                    <p className="text-sm whitespace-pre-wrap">{data.managerComments}</p>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {data.status === "pending_self"
                        ? "Nothing to do until they submit theirs."
                        : "This review is complete."}
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {writing ? (
            <Button
              disabled={rating === null || comments.trim().length === 0 || step.isPending}
              onClick={() =>
                step.mutate(
                  { id, step: "manager", body: { rating, comments: comments.trim() } },
                  {
                    onSuccess: () => {
                      toast.success("Review submitted");
                      onClose();
                    },
                    onError: (error: unknown) =>
                      toast.error(error instanceof Error ? error.message : "Could not submit it"),
                  },
                )
              }
            >
              {step.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Submit
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
