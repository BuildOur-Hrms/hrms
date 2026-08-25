"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_RATING_LABELS, RATINGS, type Rating } from "@/modules/performance/rules";
import type { CycleStatus, Goal, ReviewStatus } from "@/hooks/use-performance";

/**
 * The pieces every performance screen needs.
 *
 * A rating, a goal list and two status badges — all three views show the same
 * things from a different side, and a rating that looked different depending
 * on which screen you were on would be its own small problem.
 */

export const RATING_LABEL = DEFAULT_RATING_LABELS;

export const CYCLE_LABEL: Record<CycleStatus, string> = {
  draft: "Draft",
  active: "Goals open",
  review: "Reviews open",
  closed: "Closed",
};

export const CYCLE_TINT: Record<CycleStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-info/12 text-info",
  review: "bg-brand-soft text-brand-soft-foreground",
  closed: "bg-muted text-muted-foreground",
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending_self: "Waiting on them",
  pending_manager: "Waiting on their manager",
  completed: "Done",
};

export const REVIEW_TINT: Record<ReviewStatus, string> = {
  pending_self: "bg-warning/12 text-warning",
  pending_manager: "bg-info/12 text-info",
  completed: "bg-success/12 text-success",
};

/**
 * Pick a rating.
 *
 * Five labelled buttons rather than a dropdown or a row of stars. The labels
 * are the point — "3" means nothing on its own, and a scale where people have
 * to remember which end is good gets used inconsistently.
 */
export function RatingPicker({
  value,
  onChange,
  disabled = false,
  idPrefix,
}: {
  value: number | null;
  onChange: (rating: Rating) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Rating">
      {RATINGS.map((rating) => (
        <Button
          key={rating}
          id={`${idPrefix}-${rating}`}
          type="button"
          role="radio"
          aria-checked={value === rating}
          variant={value === rating ? "default" : "outline"}
          size="sm"
          disabled={disabled}
          onClick={() => onChange(rating)}
        >
          {rating} · {RATING_LABEL[rating]}
        </Button>
      ))}
    </div>
  );
}

/** A rating already given, shown rather than chosen. */
export function RatingBadge({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  const known = RATINGS.includes(value as Rating);

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <Badge variant="secondary" className="bg-muted text-foreground">
        {value}
        {known ? ` · ${RATING_LABEL[value as Rating]}` : ""}
      </Badge>
    </div>
  );
}

/**
 * A goal set, with what each one is worth.
 *
 * The weight is shown next to every goal rather than only in a total, because
 * "which of these actually matters" is the question a goal set exists to
 * answer and a percentage at the bottom does not answer it.
 */
export function GoalList({ goals, emptyMessage }: { goals: Goal[]; emptyMessage: string }) {
  if (goals.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <ul className="divide-border divide-y border-y">
      {goals.map((goal) => (
        <li key={goal.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{goal.title}</span>
              <Badge variant="outline" className="text-muted-foreground">
                weight {goal.weight}
              </Badge>
              {goal.origin === "assigned" ? (
                <Badge variant="outline" className="text-muted-foreground">
                  Set by their manager
                </Badge>
              ) : null}
              {goal.approvedAt === null ? (
                <Badge variant="secondary" className="bg-warning/12 text-warning">
                  Not agreed
                </Badge>
              ) : null}
            </div>
            {goal.description ? (
              <p className="text-muted-foreground text-sm">{goal.description}</p>
            ) : null}
            {goal.dueDate ? (
              <p className="text-muted-foreground text-xs">due {goal.dueDate.slice(0, 10)}</p>
            ) : null}
          </div>

          <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
            {goal.progress}%
          </span>
        </li>
      ))}
    </ul>
  );
}

/** How far through a goal set somebody is. */
export function GoalProgress({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="bg-muted h-1.5 w-full max-w-48 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Goal progress"
      >
        <div className="bg-brand h-full" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">{percent}%</span>
    </div>
  );
}
