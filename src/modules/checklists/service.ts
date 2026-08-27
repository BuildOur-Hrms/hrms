import { NOBODY, type RequestContext } from "@/lib/context";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";
import { resolveScope } from "@/lib/permissions";
import { fromDateOnly } from "@/lib/utils";

import { blockingTasks, checklistIsSettled } from "./gate";
import { planTasks, progressOf, type RoleHolders } from "./rules";
import type {
  CompleteTaskInput,
  CreateTemplateInput,
  ListTasksInput,
  ListTemplatesInput,
  StartChecklistInput,
  UpdateTemplateInput,
} from "./validators";

/**
 * Checklists, connected to the database.
 *
 * The arithmetic lives in `rules.ts`; what is here is who may see and change
 * what. Two rules carry most of the weight:
 *
 *  1. A task is settled by the person who owes it, by HR, or by the manager
 *     of the person it is about. Anyone else gets a 404 rather than a 403 —
 *     a task they cannot act on is a task they should not know exists.
 *  2. Starting a checklist copies the template. What somebody is working
 *     through is a list, not a live view of a template being edited around
 *     them.
 */

export { blockingTasks, checklistIsSettled };

function actor(ctx: RequestContext): EventActor {
  return {
    userId: ctx.userId,
    companyId: ctx.companyId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    db: ctx.db,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

// ─────────────────────────────────────────────── templates

export async function listTemplates(ctx: RequestContext, input: ListTemplatesInput) {
  return ctx.db.checklistTemplate.findMany({
    where: { deletedAt: null, ...(input.kind ? { kind: input.kind } : {}) },
    orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      kind: true,
      name: true,
      description: true,
      isDefault: true,
      _count: { select: { tasks: true } },
    },
  });
}

export async function getTemplate(ctx: RequestContext, id: string) {
  const template = await ctx.db.checklistTemplate.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      kind: true,
      name: true,
      description: true,
      isDefault: true,
      tasks: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          assignee: true,
          dueOffsetDays: true,
          isRequired: true,
          sortOrder: true,
        },
      },
    },
  });
  if (!template) throw new NotFoundError("Checklist template");
  return template;
}

/**
 * Clear the default flag on the others of that kind.
 *
 * A partial unique index already refuses two defaults, so without this a
 * second one is a constraint violation rather than a change of mind.
 */
async function clearOtherDefaults(ctx: RequestContext, kind: string, keepId?: string) {
  await ctx.db.checklistTemplate.updateMany({
    where: {
      kind: kind as "onboarding" | "offboarding",
      isDefault: true,
      deletedAt: null,
      ...(keepId ? { id: { not: keepId } } : {}),
    },
    data: { isDefault: false },
  });
}

export async function createTemplate(ctx: RequestContext, input: CreateTemplateInput) {
  if (input.isDefault) await clearOtherDefaults(ctx, input.kind);

  const template = await ctx.db.checklistTemplate.create({
    data: {
      companyId: ctx.companyId,
      kind: input.kind,
      name: input.name,
      description: input.description ?? null,
      isDefault: input.isDefault,
      tasks: {
        create: input.tasks.map((task, index) => ({
          companyId: ctx.companyId,
          title: task.title,
          description: task.description ?? null,
          assignee: task.assignee,
          dueOffsetDays: task.dueOffsetDays,
          isRequired: task.isRequired,
          // Position in the list they sent, unless they said otherwise.
          sortOrder: task.sortOrder || index,
        })),
      },
    },
    select: { id: true, kind: true, name: true },
  });

  await emit(
    "checklist.template_saved",
    { templateId: template.id, kind: template.kind, name: template.name },
    actor(ctx),
  );
  return template;
}

export async function updateTemplate(ctx: RequestContext, id: string, input: UpdateTemplateInput) {
  const existing = await ctx.db.checklistTemplate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, kind: true },
  });
  if (!existing) throw new NotFoundError("Checklist template");

  if (input.isDefault) await clearOtherDefaults(ctx, existing.kind, id);

  /*
   * Tasks are replaced wholesale rather than reconciled.
   *
   * Nothing points at a template task once a checklist has started — those
   * are copies — so there is no history to preserve here, and diffing a list
   * somebody rearranged in a form is a great deal of code for no benefit.
   */
  if (input.tasks) {
    await ctx.db.checklistTemplateTask.deleteMany({ where: { templateId: id } });
    await ctx.db.checklistTemplateTask.createMany({
      data: input.tasks.map((task, index) => ({
        companyId: ctx.companyId,
        templateId: id,
        title: task.title,
        description: task.description ?? null,
        assignee: task.assignee,
        dueOffsetDays: task.dueOffsetDays,
        isRequired: task.isRequired,
        sortOrder: task.sortOrder || index,
      })),
    });
  }

  const template = await ctx.db.checklistTemplate.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description ?? null }),
      ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
    },
    select: { id: true, kind: true, name: true },
  });

  await emit(
    "checklist.template_saved",
    { templateId: template.id, kind: template.kind, name: template.name },
    actor(ctx),
  );
  return template;
}

export async function deleteTemplate(ctx: RequestContext, id: string) {
  const template = await ctx.db.checklistTemplate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!template) throw new NotFoundError("Checklist template");

  // Archived, not erased: checklists already started name the template they
  // came from, and that reference should keep meaning something.
  await ctx.db.checklistTemplate.update({
    where: { id },
    data: { isDefault: false, deletedAt: new Date() },
  });
  return { id };
}

// ─────────────────────────────────────────────── starting a checklist

/**
 * Who fills each role for this person.
 *
 * HR is whoever is starting the checklist — they are the one who will chase
 * it. IT is nominated per run, because there is no IT role in the permission
 * model and inventing one to hold a laptop task would be a poor trade.
 */
async function rolesFor(
  ctx: RequestContext,
  employeeId: string,
  itEmployeeId: string | null,
): Promise<RoleHolders> {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true, managerId: true },
  });
  if (!employee) throw new NotFoundError("Employee");

  return {
    employeeId: employee.id,
    managerId: employee.managerId,
    hrId: ctx.employeeId ?? null,
    itId: itEmployeeId,
  };
}

async function templateFor(ctx: RequestContext, kind: string, templateId: string | null) {
  const template = await ctx.db.checklistTemplate.findFirst({
    where: {
      deletedAt: null,
      kind: kind as "onboarding" | "offboarding",
      ...(templateId ? { id: templateId } : { isDefault: true }),
    },
    select: {
      id: true,
      tasks: {
        select: {
          title: true,
          description: true,
          assignee: true,
          dueOffsetDays: true,
          isRequired: true,
          sortOrder: true,
        },
      },
    },
  });

  if (!template) {
    throw new BusinessRuleError(
      templateId
        ? "That checklist template does not exist."
        : `No default ${kind} checklist has been set up yet.`,
      { rule: "template_missing" },
    );
  }
  return template;
}

/**
 * Give somebody the checklist for arriving.
 *
 * Refused if one is already under way. Starting a second would double every
 * task and leave two gates, neither of which anybody could satisfy.
 */
export async function startOnboarding(
  ctx: RequestContext,
  employeeId: string,
  input: StartChecklistInput,
) {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true, status: true, joinDate: true },
  });
  if (!employee) throw new NotFoundError("Employee");

  if (employee.status === "exited") {
    throw new BusinessRuleError("This employee has exited.", { rule: "employee_exited" });
  }

  const already = await ctx.db.checklistTask.count({
    where: { employeeId, kind: "onboarding" },
  });
  if (already > 0) {
    throw new BusinessRuleError("This employee already has an onboarding checklist.", {
      rule: "checklist_exists",
    });
  }

  const template = await templateFor(ctx, "onboarding", input.templateId ?? null);
  const roles = await rolesFor(ctx, employeeId, input.itEmployeeId ?? null);
  const anchor = input.anchorDate ?? toDateOnly(employee.joinDate) ?? today();

  const planned = planTasks(template.tasks, anchor, roles);

  await ctx.db.checklistTask.createMany({
    data: planned.map((task) => ({
      companyId: ctx.companyId,
      kind: "onboarding" as const,
      employeeId,
      templateId: template.id,
      title: task.title,
      description: task.description ?? null,
      assignee: task.assignee,
      assignedToEmployeeId: task.assignedToEmployeeId,
      dueDate: fromDateOnly(task.dueDate),
      isRequired: task.isRequired,
      sortOrder: task.sortOrder,
    })),
  });

  await emit(
    "checklist.started",
    { employeeId, kind: "onboarding", templateId: template.id, taskCount: planned.length },
    actor(ctx),
  );

  return { employeeId, taskCount: planned.length, anchorDate: anchor };
}

// ─────────────────────────────────────────────── the tasks themselves

interface TaskRow {
  isRequired: boolean;
  status: "pending" | "completed" | "skipped";
  dueDate: Date | null;
}

function toStates(rows: TaskRow[]) {
  return rows.map((row) => ({
    isRequired: row.isRequired,
    status: row.status,
    dueDate: toDateOnly(row.dueDate),
  }));
}

/**
 * One person's checklist, with how far along it is.
 */
export async function checklistFor(
  ctx: RequestContext,
  employeeId: string,
  kind: "onboarding" | "offboarding",
) {
  const tasks = await ctx.db.checklistTask.findMany({
    where: { employeeId, kind },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      assignee: true,
      dueDate: true,
      isRequired: true,
      status: true,
      completedAt: true,
      skipReason: true,
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return { tasks, progress: progressOf(toStates(tasks), today()) };
}

/**
 * The tasks a person is being asked to do, across everybody's checklists.
 *
 * Scope decides whose: `all` sees the company, `team` sees direct reports,
 * anything less sees only their own.
 */
export async function listTasks(ctx: RequestContext, input: ListTasksInput) {
  const scope = resolveScope(ctx, "onboarding");
  const me = ctx.employeeId ?? NOBODY;

  const where: Record<string, unknown> = {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.pendingOnly ? { status: "pending" } : {}),
  };

  if (input.mine) {
    where["assignedToEmployeeId"] = me;
  } else if (scope === "all") {
    if (input.employeeId) where["employeeId"] = input.employeeId;
  } else if (scope === "team") {
    // Their own, plus anything about one of their reports.
    where["OR"] = [
      { assignedToEmployeeId: me },
      { employee: { managerId: me } },
      { employeeId: me },
    ];
  } else {
    where["OR"] = [{ assignedToEmployeeId: me }, { employeeId: me }];
  }

  return ctx.db.checklistTask.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
    take: 200,
    select: {
      id: true,
      kind: true,
      title: true,
      description: true,
      assignee: true,
      dueDate: true,
      isRequired: true,
      status: true,
      employee: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

/**
 * Mark a task done, or deliberately not done.
 *
 * Who may: the person it was given to, the manager of the person it is about,
 * or anybody who can manage onboarding. A task belonging to somebody else's
 * checklist is reported as missing rather than forbidden — knowing it exists
 * is itself information they are not owed.
 */
export async function setTaskStatus(ctx: RequestContext, taskId: string, input: CompleteTaskInput) {
  const task = await ctx.db.checklistTask.findFirst({
    where: { id: taskId },
    select: {
      id: true,
      kind: true,
      status: true,
      employeeId: true,
      assignedToEmployeeId: true,
      employee: { select: { managerId: true } },
    },
  });
  if (!task) throw new NotFoundError("Task");

  const me = ctx.employeeId;
  const scope = resolveScope(ctx, task.kind === "onboarding" ? "onboarding" : "offboarding");
  const mayAct =
    scope === "all" ||
    (me !== null && task.assignedToEmployeeId === me) ||
    (me !== null && task.employee.managerId === me);
  if (!mayAct) throw new NotFoundError("Task");

  if (input.status === "skipped" && !input.skipReason?.trim()) {
    throw new BusinessRuleError("Say why the task is being skipped.", {
      rule: "skip_needs_reason",
    });
  }

  if (task.status !== "pending") {
    throw new BusinessRuleError("That task has already been settled.", {
      rule: "task_already_settled",
    });
  }

  await ctx.db.checklistTask.update({
    where: { id: taskId },
    data: {
      status: input.status,
      completedBy: ctx.userId,
      completedAt: new Date(),
      skipReason: input.status === "skipped" ? (input.skipReason ?? null) : null,
    },
  });

  await emit(
    "checklist.task_settled",
    { taskId, employeeId: task.employeeId, kind: task.kind, status: input.status },
    actor(ctx),
  );

  return checklistFor(ctx, task.employeeId, task.kind);
}

/**
 * Everybody currently being onboarded, with how far along each one is.
 *
 * One query for the people and one for their tasks, rather than a count per
 * row — this is a page HR leaves open.
 */
export async function onboardingPipeline(ctx: RequestContext) {
  if (resolveScope(ctx, "onboarding") === "none") throw new ForbiddenError("onboarding.view_all");

  const employees = await ctx.db.employee.findMany({
    where: { status: "onboarding", deletedAt: null },
    orderBy: { joinDate: "asc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      joinDate: true,
      employeeCode: true,
      designation: { select: { title: true } },
      department: { select: { name: true } },
    },
  });
  if (employees.length === 0) return [];

  const tasks = await ctx.db.checklistTask.findMany({
    where: { kind: "onboarding", employeeId: { in: employees.map((row) => row.id) } },
    select: { employeeId: true, isRequired: true, status: true, dueDate: true },
  });

  const byEmployee = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    const list = byEmployee.get(task.employeeId) ?? [];
    list.push(task);
    byEmployee.set(task.employeeId, list);
  }

  const now = today();
  return employees.map((employee) => {
    const own = byEmployee.get(employee.id) ?? [];
    return {
      ...employee,
      // No checklist is not the same as a finished one. Reported as zero
      // tasks so the screen can say "not started" rather than "100%".
      started: own.length > 0,
      progress: progressOf(toStates(own), now),
    };
  });
}
