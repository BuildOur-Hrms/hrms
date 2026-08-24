/**
 * The rules a checklist follows, with nothing to connect to.
 *
 * Onboarding and offboarding are the same machine pointed in two directions.
 * A template is a list of tasks, each owed by a role and each due a fixed
 * number of days from a date that moves: the join date on the way in, the
 * last working day on the way out. Everything here is that arithmetic and the
 * gates that depend on it.
 *
 * Kept pure so the awkward cases — a task due before the anchor, a company
 * with no IT person, a checklist where every required task was skipped — can
 * be argued about in a test rather than discovered in production.
 */

/**
 * The vocabulary, written out rather than imported from the generated client.
 *
 * This file is arithmetic; keeping the ORM out of it is what lets the tests
 * run without a database anywhere in sight.
 */
export type ChecklistKind = "onboarding" | "offboarding";
export type ChecklistAssignee = "hr" | "it" | "manager" | "employee";
export type ChecklistTaskStatus = "pending" | "completed" | "skipped";
export type OffboardingState =
  "initiated" | "in_progress" | "cleared" | "settled" | "completed" | "cancelled";

export interface TemplateTask {
  title: string;
  assignee: ChecklistAssignee;
  dueOffsetDays: number;
  isRequired: boolean;
  sortOrder: number;
}

export interface TaskState {
  isRequired: boolean;
  status: ChecklistTaskStatus;
  dueDate: string | null;
}

/** Who fills each role, worked out once when a checklist starts. */
export interface RoleHolders {
  /** The person the checklist is about. */
  employeeId: string;
  /** Their manager, if they have one. */
  managerId: string | null;
  /** The HR person running this. */
  hrId: string | null;
  /** Whoever the company nominated for IT tasks. */
  itId: string | null;
}

/**
 * The date a task falls due.
 *
 * Plain calendar arithmetic on a `YYYY-MM-DD` string, in UTC, because these
 * are dates rather than moments — "the day the laptop comes back" does not
 * shift with a timezone. A negative offset lands before the anchor, which is
 * the normal case on the way out.
 */
export function dueDateFor(anchor: string, offsetDays: number): string {
  const date = new Date(`${anchor}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/**
 * The employee who owes a task, or nobody.
 *
 * Nobody is a real answer: a company may have no IT contact, and a new joiner
 * may have no manager on their first day. The task still exists and still
 * names the role it is waiting on, which is more useful than refusing to
 * create it or quietly handing it to HR.
 */
export function holderFor(assignee: ChecklistAssignee, roles: RoleHolders): string | null {
  switch (assignee) {
    case "employee":
      return roles.employeeId;
    case "manager":
      return roles.managerId;
    case "hr":
      return roles.hrId;
    case "it":
      return roles.itId;
  }
}

export interface PlannedTask extends TemplateTask {
  dueDate: string;
  assignedToEmployeeId: string | null;
}

/**
 * A template plus an anchor date and the people, giving the tasks to create.
 *
 * Copied rather than referenced. Editing a template next quarter must not
 * rewrite the checklist somebody is halfway through — the list they agreed to
 * is the list they finish.
 */
export function planTasks(
  template: TemplateTask[],
  anchor: string,
  roles: RoleHolders,
): PlannedTask[] {
  return [...template]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((task) => ({
      ...task,
      dueDate: dueDateFor(anchor, task.dueOffsetDays),
      assignedToEmployeeId: holderFor(task.assignee, roles),
    }));
}

export interface Progress {
  total: number;
  done: number;
  /** Required tasks still pending — the ones holding the gate shut. */
  blocking: number;
  overdue: number;
  percent: number;
}

/**
 * How far along a checklist is.
 *
 * A skipped task counts as done. Somebody looked at it and decided, with a
 * reason recorded, which is a settled question — treating it as outstanding
 * would leave every checklist permanently at 90% and teach people to ignore
 * the number.
 */
export function progressOf(tasks: TaskState[], today: string): Progress {
  const total = tasks.length;
  const done = tasks.filter((task) => task.status !== "pending").length;
  const blocking = tasks.filter((task) => task.isRequired && task.status === "pending").length;
  const overdue = tasks.filter(
    (task) => task.status === "pending" && task.dueDate !== null && task.dueDate < today,
  ).length;

  return {
    total,
    done,
    blocking,
    overdue,
    // An empty checklist is finished, not divided by zero.
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
  };
}

/**
 * Whether the gate opens.
 *
 * Required tasks must be settled — done or deliberately skipped. Optional
 * ones never hold anybody up, which is the only thing that makes "optional"
 * mean anything.
 */
export function requiredTasksSettled(tasks: TaskState[]): boolean {
  return tasks.every((task) => !task.isRequired || task.status !== "pending");
}

/** The order an exit moves through, and what may follow what. */
export const OFFBOARDING_NEXT: Record<OffboardingState, readonly OffboardingState[]> = {
  initiated: ["in_progress", "cancelled"],
  in_progress: ["cleared", "cancelled"],
  cleared: ["settled", "cancelled"],
  settled: ["completed"],
  completed: [],
  cancelled: [],
};

/**
 * Whether an exit may move from one state to the next.
 *
 * Forward only, and not past `settled` — an exit that has been settled has
 * had money paid against it, and the way to undo that is another payment,
 * not a status change. Cancellation is allowed while the person is still
 * here, which is what makes withdrawing a resignation possible.
 */
export function canAdvance(from: OffboardingState, to: OffboardingState): boolean {
  return OFFBOARDING_NEXT[from].includes(to);
}

/**
 * The last working day, from the notice period.
 *
 * Whichever is later: the day the person asked for, or the day their notice
 * actually runs out. Somebody who offers a fortnight when they owe a month
 * has made a request, not a decision — and HR can still override the result
 * outright, because notice gets waived all the time.
 */
export function lastWorkingDay(
  submittedOn: string,
  requested: string,
  noticePeriodDays: number,
): string {
  const earliest = dueDateFor(submittedOn, noticePeriodDays);
  return requested > earliest ? requested : earliest;
}
