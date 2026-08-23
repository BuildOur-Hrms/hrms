/**
 * Turning a list of tasks into one percentage.
 *
 * Pure, and kept apart from everything that reads a database, because this is
 * the number a person will be judged on and possibly paid against. It has to
 * be inspectable without a fixture and arguable without a debugger.
 *
 * Three decisions are worth stating out loud, since each one changes what the
 * number means:
 *
 *   1. **Weighted, not counted.** Finishing the one task that mattered beats
 *      finishing four that did not. Weights are relative — 3 and 1 means the
 *      first is worth three times the second, and nothing has to total 100.
 *
 *   2. **Cancelled work is not work.** A cancelled task leaves the calculation
 *      entirely rather than counting as zero. Counting it would punish
 *      somebody for a decision that was usually not theirs.
 *
 *   3. **Assigned and self-added are reported separately.** They are different
 *      claims: one is what the company asked for, the other is what a person
 *      chose. Averaging them together would let anyone raise their own figure
 *      by adding easy tasks to their own list, which is exactly the number
 *      nobody could then defend.
 */

export type TaskOrigin = "assigned" | "self";
export type TaskStatus = "not_started" | "in_progress" | "completed" | "cancelled";

export interface CompletableTask {
  origin: TaskOrigin;
  status: TaskStatus;
  weight: number;
  progress: number;
}

export interface CompletionSlice {
  /** Weighted percentage, 0–100, to one decimal place. */
  percent: number;
  /** Tasks counted — cancelled ones are not among them. */
  total: number;
  completed: number;
  /** Sum of the weights counted, so a caller can see how much this rests on. */
  weight: number;
}

export interface Completion {
  /** What the company asked for. The figure that carries weight. */
  assigned: CompletionSlice;
  /** What the person added themselves. Shown, never blended in. */
  self: CompletionSlice;
  /** Everything, for the person's own view of their own month. */
  overall: CompletionSlice;
}

const EMPTY: CompletionSlice = { percent: 0, total: 0, completed: 0, weight: 0 };

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function slice(tasks: readonly CompletableTask[]): CompletionSlice {
  const counted = tasks.filter((task) => task.status !== "cancelled");
  if (counted.length === 0) return { ...EMPTY };

  const weight = counted.reduce((sum, task) => sum + task.weight, 0);
  // Guard rather than assume: the database constrains weight to 1–100, and a
  // zero here would be a divide by zero on a screen somebody is reading.
  if (weight <= 0) return { ...EMPTY, total: counted.length };

  const earned = counted.reduce((sum, task) => sum + task.weight * task.progress, 0);

  return {
    percent: round1(earned / weight),
    total: counted.length,
    completed: counted.filter((task) => task.status === "completed").length,
    weight,
  };
}

export function completionOf(tasks: readonly CompletableTask[]): Completion {
  return {
    assigned: slice(tasks.filter((task) => task.origin === "assigned")),
    self: slice(tasks.filter((task) => task.origin === "self")),
    overall: slice(tasks),
  };
}

/**
 * The single number to lead with.
 *
 * Assigned work when there is any, and only then the person's own — so
 * somebody with nothing assigned still sees a figure for the month rather
 * than a zero that reads like a failure.
 */
export function headline(completion: Completion): { percent: number; basis: TaskOrigin | null } {
  if (completion.assigned.total > 0)
    return { percent: completion.assigned.percent, basis: "assigned" };
  if (completion.self.total > 0) return { percent: completion.self.percent, basis: "self" };
  return { percent: 0, basis: null };
}

/**
 * Where a percentage sits, for the one place colour is allowed to mean
 * something. Thresholds live here rather than in a component so the chart and
 * the table can never disagree about what "behind" looks like.
 */
export type CompletionBand = "ahead" | "on-track" | "behind" | "at-risk";

export function bandFor(percent: number): CompletionBand {
  if (percent >= 90) return "ahead";
  if (percent >= 70) return "on-track";
  if (percent >= 40) return "behind";
  return "at-risk";
}
