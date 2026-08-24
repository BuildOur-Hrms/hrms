import type { RequestContext } from "@/lib/context";

import { requiredTasksSettled } from "./rules";

/**
 * Whether a checklist is holding something up.
 *
 * Its own file, and it imports nothing from any other module, because both
 * sides of a gate need to ask the same question: the employee module before
 * activating a new joiner, and the offboarding service before clearing an
 * exit. Keeping it here is what lets those two import in one direction each
 * without pointing at one another.
 */

/** The required tasks still standing in the way, by name. */
export async function blockingTasks(
  ctx: RequestContext,
  employeeId: string,
  kind: "onboarding" | "offboarding",
): Promise<string[]> {
  const tasks = await ctx.db.checklistTask.findMany({
    where: { employeeId, kind, isRequired: true, status: "pending" },
    orderBy: { sortOrder: "asc" },
    select: { title: true },
  });
  return tasks.map((task) => task.title);
}

/** Whether every required task on a checklist has been settled. */
export async function checklistIsSettled(
  ctx: RequestContext,
  employeeId: string,
  kind: "onboarding" | "offboarding",
): Promise<boolean> {
  const tasks = await ctx.db.checklistTask.findMany({
    where: { employeeId, kind },
    select: { isRequired: true, status: true },
  });
  return requiredTasksSettled(tasks.map((task) => ({ ...task, dueDate: null })));
}
