import type { RequestContext } from "@/lib/context";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emit, type EventActor } from "@/lib/events";

import { completionOf, headline, type CompletableTask, type Completion } from "./completion";
import type { BoardInput, CreateTaskInput, ListTasksInput, UpdateTaskInput } from "./validators";

/**
 * Job tasks: what somebody is meant to get done this month, and how far along
 * it is.
 *
 * Two rules run through everything here.
 *
 * **Origin is decided by the server, never sent.** Creating a task for
 * yourself makes it `self`; creating one for somebody else makes it
 * `assigned`. If a client could choose, anyone could label their own additions
 * as company-assigned and the split would mean nothing.
 *
 * **An employee may move a task along but not rewrite it.** Progress and
 * status are theirs — they are doing the work. Title, weight and due date
 * belong to whoever set it, because a target you can re-weight is not a
 * target.
 */

/** A person who is not on anybody's team, for scopes that resolve to nobody. */
const NOBODY = "00000000-0000-0000-0000-000000000000";

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

const TASK_FIELDS = {
  id: true,
  employeeId: true,
  origin: true,
  title: true,
  description: true,
  weight: true,
  progress: true,
  status: true,
  year: true,
  month: true,
  dueDate: true,
  completedAt: true,
  createdAt: true,
  author: { select: { id: true, email: true } },
} as const;

type TaskRow = { dueDate: Date | null; completedAt: Date | null } & Record<string, unknown>;

/** Dates leave as `YYYY-MM-DD`; a serialised Date would carry a meaningless time. */
function present<T extends TaskRow>(row: T) {
  return {
    ...row,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function ownEmployeeId(ctx: RequestContext): string {
  if (!ctx.employeeId) {
    throw new ConflictError("This account has no employee record, so it has no task list.");
  }
  return ctx.employeeId;
}

// ─────────────────────────────────────────────── who may see whose

export type TaskScope = "own" | "team" | "all";

function widestScope(ctx: RequestContext): TaskScope | null {
  if (ctx.permissions.has("performance.view_all")) return "all";
  if (ctx.permissions.has("performance.view_team")) return "team";
  if (ctx.permissions.has("performance.view_own")) return "own";
  return null;
}

/**
 * Whether this caller may look at that person's list.
 *
 * A foreign employee is a 404 rather than a 403 throughout — a 403 confirms
 * the person exists, which is a leak on an endpoint anybody can call with a
 * guessed id.
 */
async function assertCanView(ctx: RequestContext, employeeId: string): Promise<void> {
  const scope = widestScope(ctx);
  if (!scope) throw new ForbiddenError("You cannot see task lists");
  if (employeeId === ctx.employeeId) return;
  if (scope === "all") {
    const exists = await ctx.db.employee.findFirst({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError("Employee");
    return;
  }

  if (scope === "team") {
    const report = await ctx.db.employee.findFirst({
      where: { id: employeeId, managerId: ctx.employeeId ?? NOBODY },
      select: { id: true },
    });
    if (!report) throw new NotFoundError("Employee");
    return;
  }

  throw new NotFoundError("Employee");
}

/** Whether this caller may *set* work for that person, rather than merely read it. */
async function assertCanAssign(ctx: RequestContext, employeeId: string): Promise<void> {
  if (!ctx.permissions.has("performance.create")) {
    throw new ForbiddenError("You cannot create tasks");
  }
  if (employeeId === ctx.employeeId) return;

  // Assigning is editing somebody's targets, so it needs more than the right
  // to look at them.
  const canAssign =
    ctx.permissions.has("performance.edit") ||
    ctx.permissions.has("performance.manage") ||
    ctx.permissions.has("performance.view_team");
  if (!canAssign) throw new ForbiddenError("You can only add tasks to your own list");

  await assertCanView(ctx, employeeId);
}

// ─────────────────────────────────────────────── reading

export async function listTasks(ctx: RequestContext, input: ListTasksInput) {
  const employeeId = input.employeeId ?? ownEmployeeId(ctx);
  await assertCanView(ctx, employeeId);

  const rows = await ctx.db.jobTask.findMany({
    where: { employeeId, year: input.year, month: input.month },
    orderBy: [{ origin: "asc" }, { weight: "desc" }, { createdAt: "asc" }],
    select: TASK_FIELDS,
  });

  const completion = completionOf(rows as unknown as CompletableTask[]);

  return {
    year: input.year,
    month: input.month,
    employeeId,
    tasks: rows.map(present),
    completion,
    headline: headline(completion),
  };
}

/** The months behind this one, for the trend line. */
function previousMonths(year: number, month: number, count: number) {
  const months: { year: number; month: number }[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    months.push({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }
  return months;
}

export interface BoardRow {
  employee: {
    id: string;
    firstName: string;
    lastName: string | null;
    employeeCode: string;
    department: string | null;
  };
  completion: Completion;
  headline: ReturnType<typeof headline>;
}

/**
 * Everyone the caller may see, for one month, plus the trend behind it.
 *
 * One query for the whole window rather than one per month: a year of history
 * for two hundred people is a single index scan, and twelve round trips would
 * be twelve chances for the chart to render half-built.
 */
export async function taskBoard(ctx: RequestContext, input: BoardInput) {
  const scope = widestScope(ctx);
  if (input.scope === "all" && scope !== "all") {
    throw new ForbiddenError("You can only see your own team's tasks");
  }
  if (input.scope === "team" && scope === null) {
    throw new ForbiddenError("You cannot see task lists");
  }

  const window = previousMonths(input.year, input.month, input.months);
  const earliest = window[0]!;

  const employees = await ctx.db.employee.findMany({
    where: {
      status: { in: ["active", "onboarding"] },
      ...(input.scope === "team" || scope === "team"
        ? { managerId: ctx.employeeId ?? NOBODY }
        : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 500,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      department: { select: { name: true } },
    },
  });

  const ids = employees.map((employee) => employee.id);
  const tasks = ids.length
    ? await ctx.db.jobTask.findMany({
        where: {
          employeeId: { in: ids },
          // The whole window in one query. Twelve separate reads would be
          // twelve chances for the chart to render half-built.
          OR: window.map((m) => ({ year: m.year, month: m.month })),
        },
        select: {
          employeeId: true,
          origin: true,
          status: true,
          weight: true,
          progress: true,
          year: true,
          month: true,
        },
      })
    : [];

  const thisMonth = tasks.filter((t) => t.year === input.year && t.month === input.month);
  const byEmployee = new Map<string, CompletableTask[]>();
  for (const task of thisMonth) {
    const bucket = byEmployee.get(task.employeeId) ?? [];
    bucket.push(task as unknown as CompletableTask);
    byEmployee.set(task.employeeId, bucket);
  }

  const rows: BoardRow[] = employees.map((employee) => {
    const completion = completionOf(byEmployee.get(employee.id) ?? []);
    return {
      employee: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeCode: employee.employeeCode,
        department: employee.department?.name ?? null,
      },
      completion,
      headline: headline(completion),
    };
  });

  // The company trend: one weighted figure per month across everybody in
  // scope, so the chart shows the shape of the team rather than of one person.
  const trend = window.map((m) => {
    const forMonth = tasks.filter((t) => t.year === m.year && t.month === m.month);
    const completion = completionOf(forMonth as unknown as CompletableTask[]);
    return {
      year: m.year,
      month: m.month,
      label: `${m.year}-${String(m.month).padStart(2, "0")}`,
      assigned: completion.assigned.percent,
      self: completion.self.percent,
      people: new Set(forMonth.map((t) => t.employeeId)).size,
    };
  });

  const everyone = completionOf(thisMonth as unknown as CompletableTask[]);

  return {
    year: input.year,
    month: input.month,
    scope: input.scope,
    rows,
    trend,
    completion: everyone,
    // Stated rather than inferred: a board where half the company has no tasks
    // is a board whose average means very little, and the screen should say so.
    withTasks: rows.filter((row) => row.headline.basis !== null).length,
    earliest: `${earliest.year}-${String(earliest.month).padStart(2, "0")}`,
  };
}

/** One person's trend, for their own screen. */
export async function taskTrend(ctx: RequestContext, employeeId: string, input: BoardInput) {
  await assertCanView(ctx, employeeId);

  const window = previousMonths(input.year, input.month, input.months);
  const tasks = await ctx.db.jobTask.findMany({
    where: {
      employeeId,
      OR: window.map((m) => ({ year: m.year, month: m.month })),
    },
    select: { origin: true, status: true, weight: true, progress: true, year: true, month: true },
  });

  return window.map((m) => {
    const completion = completionOf(
      tasks.filter((t) => t.year === m.year && t.month === m.month) as unknown as CompletableTask[],
    );
    return {
      year: m.year,
      month: m.month,
      label: `${m.year}-${String(m.month).padStart(2, "0")}`,
      assigned: completion.assigned.percent,
      self: completion.self.percent,
      total: completion.overall.total,
    };
  });
}

// ─────────────────────────────────────────────── writing

export async function createTask(ctx: RequestContext, input: CreateTaskInput) {
  const employeeId = input.employeeId ?? ownEmployeeId(ctx);
  await assertCanAssign(ctx, employeeId);

  // Decided here and never taken from the body. See the note at the top.
  const origin = employeeId === ctx.employeeId ? "self" : "assigned";

  const task = await ctx.db.jobTask.create({
    data: {
      companyId: ctx.companyId,
      employeeId,
      createdBy: ctx.userId,
      origin,
      title: input.title,
      description: input.description ?? null,
      weight: input.weight,
      year: input.year,
      month: input.month,
      dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
    },
    select: TASK_FIELDS,
  });

  await emit(
    "task.created",
    {
      taskId: task.id,
      employeeId,
      origin,
      title: input.title,
      weight: input.weight,
      period: `${input.year}-${String(input.month).padStart(2, "0")}`,
    },
    actor(ctx),
  );

  return present(task);
}

export async function updateTask(ctx: RequestContext, id: string, input: UpdateTaskInput) {
  const task = await ctx.db.jobTask.findFirst({
    where: { id },
    select: { id: true, employeeId: true, origin: true, status: true, progress: true },
  });
  if (!task) throw new NotFoundError("Task");

  await assertCanView(ctx, task.employeeId);

  const isOwn = task.employeeId === ctx.employeeId;
  const canEdit =
    ctx.permissions.has("performance.edit") || ctx.permissions.has("performance.manage");

  // The person doing the work owns how far along it is. Everything else is
  // the shape of the target, which belongs to whoever set it.
  const rewriting =
    input.title !== undefined ||
    input.description !== undefined ||
    input.weight !== undefined ||
    input.dueDate !== undefined;

  if (rewriting && !canEdit && !(isOwn && task.origin === "self")) {
    throw new ForbiddenError("You can update your progress, but not change the task itself");
  }
  if (!isOwn && !canEdit && !ctx.permissions.has("performance.view_team")) {
    throw new ForbiddenError("You cannot change this task");
  }

  const status = input.status ?? task.status;
  // Completion is a single fact. Marking a task done at 40% would leave the
  // list and the percentage disagreeing about the same row, and the database
  // refuses it anyway.
  const progress = status === "completed" ? 100 : (input.progress ?? task.progress);

  const updated = await ctx.db.jobTask.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.dueDate !== undefined
        ? { dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null }
        : {}),
      progress,
      status,
      completedAt: status === "completed" ? new Date() : null,
    },
    select: TASK_FIELDS,
  });

  await emit(
    "task.updated",
    {
      taskId: id,
      employeeId: task.employeeId,
      from: { status: task.status, progress: task.progress },
      to: { status, progress },
    },
    actor(ctx),
  );

  return present(updated);
}

export async function deleteTask(ctx: RequestContext, id: string): Promise<void> {
  const task = await ctx.db.jobTask.findFirst({
    where: { id },
    select: { id: true, employeeId: true, origin: true, title: true },
  });
  if (!task) throw new NotFoundError("Task");

  const isOwn = task.employeeId === ctx.employeeId;
  const canEdit =
    ctx.permissions.has("performance.edit") || ctx.permissions.has("performance.manage");

  // Somebody can withdraw what they added themselves. Removing an assigned
  // task is a decision about the target, and belongs to whoever set it.
  if (!(canEdit || (isOwn && task.origin === "self"))) {
    throw new ForbiddenError("You cannot remove a task somebody else set for you");
  }
  await assertCanView(ctx, task.employeeId);

  await ctx.db.jobTask.delete({ where: { id } });

  await emit(
    "task.deleted",
    { taskId: id, employeeId: task.employeeId, origin: task.origin, title: task.title },
    actor(ctx),
  );
}
