import { beforeAll, describe, expect, it } from "vitest";

import { GET as listTasks, POST as createTask } from "@/app/api/v1/tasks/route";
import { DELETE as deleteTask, PATCH as updateTask } from "@/app/api/v1/tasks/[id]/route";
import { GET as taskBoard } from "@/app/api/v1/tasks/board/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Persona, type Tenants } from "./harness";

/**
 * Job tasks, end to end.
 *
 * The rules under test are the ones that decide whether the percentage can be
 * argued with: origin is set by the server, an employee moves work along but
 * cannot re-weight it, and nobody sees another company's board.
 */

const YEAR = 2026;
const MONTH = 9;

let t: Tenants;

async function add(as: Persona, body: Record<string, unknown>) {
  return call<{ id: string; origin: string; weight: number }>(createTask, "/api/v1/tasks", {
    as,
    body: { year: YEAR, month: MONTH, ...body },
  });
}

async function listFor(as: Persona, employeeId?: string) {
  return call<{
    tasks: { id: string; origin: string; progress: number }[];
    completion: { assigned: { percent: number }; self: { percent: number } };
    headline: { percent: number; basis: string | null };
  }>(listTasks, "/api/v1/tasks", {
    as,
    query: { year: YEAR, month: MONTH, ...(employeeId ? { employeeId } : {}) },
  });
}

beforeAll(async () => {
  t = await seedTenants();
});

describe("who a task belongs to decides where it came from", () => {
  it("marks a task somebody adds for themselves as self-added", async () => {
    const result = await add(t.acme.employee, { title: "Tidy the backlog", weight: 1 });

    expect(result.status, result.error?.message).toBe(201);
    expect(result.data.origin).toBe("self");
  });

  it("marks a task a manager sets for a report as assigned", async () => {
    const result = await add(t.acme.manager, {
      employeeId: t.acme.employee.employeeId,
      title: "Close ten tickets",
      weight: 3,
    });

    expect(result.status, result.error?.message).toBe(201);
    expect(result.data.origin).toBe("assigned");
  });

  it("cannot be told otherwise by the body", async () => {
    // `origin` is not in the schema, so it is stripped rather than honoured.
    const result = await add(t.acme.employee, {
      title: "Claiming this was assigned",
      origin: "assigned",
    });

    expect(result.status).toBe(201);
    expect(result.data.origin).toBe("self");
  });

  it("refuses an employee setting work for somebody else", async () => {
    const result = await add(t.acme.employee, {
      employeeId: t.acme.manager.employeeId,
      title: "Do my job for me",
    });

    expect(result.status).toBe(403);
  });
});

describe("the percentage", () => {
  it("keeps assigned and self-added apart", async () => {
    const before = await listFor(t.acme.employee);
    const assigned = before.data.tasks.find((task) => task.origin === "assigned")!;

    const moved = await call(updateTask, `/api/v1/tasks/${assigned.id}`, {
      as: t.acme.employee,
      method: "PATCH",
      params: { id: assigned.id },
      body: { progress: 50 },
    });
    expect(moved.status, moved.error?.message).toBe(200);

    const after = await listFor(t.acme.employee);
    expect(after.data.completion.assigned.percent).toBe(50);
    // The self-added tasks sit at zero and have not dragged the assigned
    // figure down with them.
    expect(after.data.headline).toEqual({ percent: 50, basis: "assigned" });
  });

  it("cannot be raised by adding easy work to your own list", async () => {
    const before = await listFor(t.acme.employee);

    const own = await add(t.acme.employee, { title: "Something quick", weight: 10 });
    await call(updateTask, `/api/v1/tasks/${own.data.id}`, {
      as: t.acme.employee,
      method: "PATCH",
      params: { id: own.data.id },
      body: { status: "completed" },
    });

    const after = await listFor(t.acme.employee);
    expect(after.data.completion.assigned.percent).toBe(before.data.completion.assigned.percent);
    expect(after.data.completion.self.percent).toBeGreaterThan(0);
  });

  it("treats a completed task as finished, whatever progress was sent", async () => {
    const created = await add(t.acme.manager, {
      employeeId: t.acme.employee.employeeId,
      title: "Finish the migration",
    });

    const done = await call<{ progress: number; completedAt: string | null }>(
      updateTask,
      `/api/v1/tasks/${created.data.id}`,
      {
        as: t.acme.employee,
        method: "PATCH",
        params: { id: created.data.id },
        body: { status: "completed", progress: 40 },
      },
    );

    expect(done.status).toBe(200);
    expect(done.data.progress).toBe(100);
    expect(done.data.completedAt).not.toBeNull();
  });
});

describe("what an employee may change", () => {
  let assignedId: string;

  beforeAll(async () => {
    const created = await add(t.acme.manager, {
      employeeId: t.acme.employee.employeeId,
      title: "Weighted heavily",
      weight: 5,
    });
    assignedId = created.data.id;
  });

  it("lets them move their own progress", async () => {
    const result = await call(updateTask, `/api/v1/tasks/${assignedId}`, {
      as: t.acme.employee,
      method: "PATCH",
      params: { id: assignedId },
      body: { progress: 30 },
    });
    expect(result.status).toBe(200);
  });

  it("refuses to let them re-weight the target they are measured on", async () => {
    const result = await call(updateTask, `/api/v1/tasks/${assignedId}`, {
      as: t.acme.employee,
      method: "PATCH",
      params: { id: assignedId },
      body: { weight: 1 },
    });

    expect(result.status).toBe(403);
    expect(result.error?.message).toMatch(/progress/i);
  });

  it("refuses to let them delete it", async () => {
    const result = await call(deleteTask, `/api/v1/tasks/${assignedId}`, {
      as: t.acme.employee,
      method: "DELETE",
      params: { id: assignedId },
    });

    expect(result.status).toBe(403);
  });

  it("lets them withdraw something they added themselves", async () => {
    const own = await add(t.acme.employee, { title: "Changed my mind" });
    const result = await call(deleteTask, `/api/v1/tasks/${own.data.id}`, {
      as: t.acme.employee,
      method: "DELETE",
      params: { id: own.data.id },
    });

    expect(result.status).toBe(200);
  });
});

describe("the board", () => {
  it("shows HR the whole company", async () => {
    const result = await call<{ rows: unknown[]; withTasks: number; trend: unknown[] }>(
      taskBoard,
      "/api/v1/tasks/board",
      { as: t.acme.hr, query: { year: YEAR, month: MONTH, scope: "all", months: 6 } },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.rows.length).toBeGreaterThan(1);
    expect(result.data.trend).toHaveLength(6);
    // Said out loud, because an average over three people out of forty is not
    // an average of the company.
    expect(result.data.withTasks).toBeGreaterThan(0);
  });

  it("shows a manager only their own reports", async () => {
    const result = await call<{ rows: { employee: { id: string } }[] }>(
      taskBoard,
      "/api/v1/tasks/board",
      { as: t.acme.manager, query: { year: YEAR, month: MONTH, scope: "team" } },
    );

    expect(result.status).toBe(200);
    expect(result.data.rows.map((row) => row.employee.id)).toEqual([t.acme.employee.employeeId]);
  });

  it("refuses a manager asking for the whole company", async () => {
    const result = await call(taskBoard, "/api/v1/tasks/board", {
      as: t.acme.manager,
      query: { year: YEAR, month: MONTH, scope: "all" },
    });

    expect(result.status).toBe(403);
  });
});

describe("across companies", () => {
  it("refuses to read a foreign list, without confirming the person exists", async () => {
    const result = await listFor(t.acme.hr, t.globex.employee.employeeId);
    expect(result.status).toBe(404);
  });

  it("refuses to assign into another company", async () => {
    const result = await add(t.acme.hr, {
      employeeId: t.globex.employee.employeeId,
      title: "Reaching across the boundary",
    });
    expect(result.status).toBe(404);
  });

  it("keeps the boards separate", async () => {
    const acme = await call<{ rows: { employee: { id: string } }[] }>(
      taskBoard,
      "/api/v1/tasks/board",
      { as: t.acme.hr, query: { year: YEAR, month: MONTH, scope: "all" } },
    );
    const globex = await call<{ rows: { employee: { id: string } }[] }>(
      taskBoard,
      "/api/v1/tasks/board",
      { as: t.globex.hr, query: { year: YEAR, month: MONTH, scope: "all" } },
    );

    const mine = new Set(acme.data.rows.map((row) => row.employee.id));
    for (const row of globex.data.rows) expect(mine.has(row.employee.id)).toBe(false);
  });
});

describe("the audit trail", () => {
  it("records an assignment, and not every nudge of a progress bar", async () => {
    const rows = await withPlatform((db) =>
      db.auditLog.findMany({
        where: { companyId: t.acme.companyId, entityType: "job_task" },
        select: { action: true },
      }),
    );

    const actions = new Set(rows.map((row) => row.action));
    expect(actions.has("task.created")).toBe(true);
    // Progress moves constantly. Burying "your manager set you a target" under
    // that is how an audit trail stops being read.
    expect(actions.has("task.updated")).toBe(false);
  });
});
