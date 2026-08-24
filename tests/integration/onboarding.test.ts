import { beforeAll, describe, expect, it } from "vitest";

import { GET as getTasks } from "@/app/api/v1/checklist-tasks/route";
import { PATCH as settleTask } from "@/app/api/v1/checklist-tasks/[id]/route";
import { POST as createTemplate } from "@/app/api/v1/checklist-templates/route";
import { GET as pipeline } from "@/app/api/v1/onboarding/pipeline/route";
import {
  GET as getChecklist,
  POST as startOnboarding,
} from "@/app/api/v1/employees/[id]/onboarding/route";
import { POST as changeStatus } from "@/app/api/v1/employees/[id]/status/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * Onboarding, end to end.
 *
 * The parts worth proving against a real database are the ones the pure rules
 * cannot: who may settle a task, whether the activation gate actually holds,
 * and whether one company can see another's checklists.
 */

let t: Tenants;
let templateId: string;
let joinerId: string;

beforeAll(async () => {
  t = await seedTenants();

  // Somebody mid-onboarding, reporting to the manager persona.
  joinerId = await withPlatform(async (db) => {
    const employee = await db.employee.create({
      data: {
        companyId: t.acme.companyId,
        employeeCode: "ACME-JOINER",
        firstName: "Nadia",
        lastName: "Arrives",
        departmentId: t.acme.departmentId,
        designationId: t.acme.designationId,
        locationId: t.acme.locationId,
        managerId: t.acme.manager.employeeId,
        employmentType: "full_time",
        status: "onboarding",
        joinDate: new Date("2026-03-02"),
      },
      select: { id: true },
    });
    return employee.id;
  });
});

describe("writing a checklist", () => {
  it("is refused to somebody who only does their own tasks", async () => {
    const result = await call(createTemplate, "/api/v1/checklist-templates", {
      as: t.acme.employee,
      method: "POST",
      body: {
        kind: "onboarding",
        name: "Should not exist",
        tasks: [{ title: "x", assignee: "hr" }],
      },
    });

    expect(result.status).toBe(403);
  });

  it("refuses one with no tasks, which would be a name and nothing else", async () => {
    const result = await call(createTemplate, "/api/v1/checklist-templates", {
      as: t.acme.hr,
      method: "POST",
      body: { kind: "onboarding", name: "Empty", tasks: [] },
    });

    expect(result.status).toBe(400);
  });

  it("saves one, with its tasks", async () => {
    const result = await call<{ id: string }>(createTemplate, "/api/v1/checklist-templates", {
      as: t.acme.hr,
      method: "POST",
      body: {
        kind: "onboarding",
        name: "Standard joiner",
        isDefault: true,
        tasks: [
          { title: "Laptop ready", assignee: "it", dueOffsetDays: -2, sortOrder: 1 },
          { title: "Sign the contract", assignee: "employee", dueOffsetDays: 0, sortOrder: 2 },
          { title: "First-week catch-up", assignee: "manager", dueOffsetDays: 5, sortOrder: 3 },
          {
            title: "Team lunch",
            assignee: "manager",
            dueOffsetDays: 7,
            isRequired: false,
            sortOrder: 4,
          },
        ],
      },
    });

    expect(result.status, result.error?.message).toBe(201);
    templateId = result.data.id;
  });
});

describe("starting one", () => {
  it("dates every task from the join date", async () => {
    const result = await call<{ taskCount: number; anchorDate: string }>(
      startOnboarding,
      `/api/v1/employees/${joinerId}/onboarding`,
      { as: t.acme.hr, method: "POST", params: { id: joinerId }, body: { templateId } },
    );

    expect(result.status, result.error?.message).toBe(201);
    expect(result.data.taskCount).toBe(4);
    expect(result.data.anchorDate).toBe("2026-03-02");

    const dates = await withPlatform((db) =>
      db.checklistTask.findMany({
        where: { employeeId: joinerId },
        orderBy: { sortOrder: "asc" },
        select: { title: true, dueDate: true, assignedToEmployeeId: true },
      }),
    );

    expect(dates.map((row) => row.dueDate?.toISOString().slice(0, 10))).toEqual([
      "2026-02-28",
      "2026-03-02",
      "2026-03-07",
      "2026-03-09",
    ]);
  });

  it("resolves the roles to real people, and leaves IT waiting on nobody", async () => {
    const rows = await withPlatform((db) =>
      db.checklistTask.findMany({
        where: { employeeId: joinerId },
        orderBy: { sortOrder: "asc" },
        select: { assignee: true, assignedToEmployeeId: true },
      }),
    );

    expect(rows[0]).toMatchObject({ assignee: "it", assignedToEmployeeId: null });
    expect(rows[1]?.assignedToEmployeeId).toBe(joinerId);
    expect(rows[2]?.assignedToEmployeeId).toBe(t.acme.manager.employeeId);
  });

  it("refuses to start a second one", async () => {
    const result = await call(startOnboarding, `/api/v1/employees/${joinerId}/onboarding`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: joinerId },
      body: { templateId },
    });

    expect(result.status).toBe(422);
    expect(result.error?.code).toBe("BUSINESS_RULE");
  });

  it("keeps the copy even when the template changes underneath", async () => {
    await withPlatform((db) =>
      db.checklistTemplateTask.updateMany({
        where: { templateId },
        data: { title: "Rewritten after the fact" },
      }),
    );

    const result = await call<{ tasks: { title: string }[] }>(
      getChecklist,
      `/api/v1/employees/${joinerId}/onboarding`,
      { as: t.acme.hr, params: { id: joinerId } },
    );

    expect(result.data.tasks.map((task) => task.title)).toContain("Laptop ready");
    expect(result.data.tasks.map((task) => task.title)).not.toContain("Rewritten after the fact");
  });
});

describe("the gate", () => {
  it("refuses to activate while a required task is pending, and names what is left", async () => {
    const result = await call(changeStatus, `/api/v1/employees/${joinerId}/status`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: joinerId },
      body: { status: "active" },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/Laptop ready/);
  });
});

describe("settling a task", () => {
  let laptopTaskId: string;
  let contractTaskId: string;

  beforeAll(async () => {
    const rows = await withPlatform((db) =>
      db.checklistTask.findMany({
        where: { employeeId: joinerId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true },
      }),
    );
    laptopTaskId = rows[0]!.id;
    contractTaskId = rows[1]!.id;
  });

  it("is not offered to somebody with no part in it", async () => {
    // Not 403: a task on somebody else's checklist is not theirs to know about.
    const result = await call(settleTask, `/api/v1/checklist-tasks/${contractTaskId}`, {
      as: t.acme.employee,
      method: "PATCH",
      params: { id: contractTaskId },
      body: { status: "completed" },
    });

    expect(result.status).toBe(404);
  });

  it("refuses a skip with no reason", async () => {
    const result = await call(settleTask, `/api/v1/checklist-tasks/${laptopTaskId}`, {
      as: t.acme.hr,
      method: "PATCH",
      params: { id: laptopTaskId },
      body: { status: "skipped", skipReason: "   " },
    });

    expect(result.status).toBe(422);
  });

  it("lets HR skip it with one", async () => {
    const result = await call<{ progress: { done: number } }>(
      settleTask,
      `/api/v1/checklist-tasks/${laptopTaskId}`,
      {
        as: t.acme.hr,
        method: "PATCH",
        params: { id: laptopTaskId },
        body: { status: "skipped", skipReason: "They are bringing their own machine." },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.progress.done).toBe(1);
  });

  it("refuses to settle the same task twice", async () => {
    const result = await call(settleTask, `/api/v1/checklist-tasks/${laptopTaskId}`, {
      as: t.acme.hr,
      method: "PATCH",
      params: { id: laptopTaskId },
      body: { status: "completed" },
    });

    expect(result.status).toBe(422);
  });

  it("lets the manager settle a task about one of their reports", async () => {
    const result = await call(settleTask, `/api/v1/checklist-tasks/${contractTaskId}`, {
      as: t.acme.manager,
      method: "PATCH",
      params: { id: contractTaskId },
      body: { status: "completed" },
    });

    expect(result.status, result.error?.message).toBe(200);
  });
});

describe("once everything required is settled", () => {
  beforeAll(async () => {
    // The remaining required task, left for the manager.
    const rows = await withPlatform((db) =>
      db.checklistTask.findMany({
        where: { employeeId: joinerId, status: "pending", isRequired: true },
        select: { id: true },
      }),
    );
    for (const row of rows) {
      await call(settleTask, `/api/v1/checklist-tasks/${row.id}`, {
        as: t.acme.hr,
        method: "PATCH",
        params: { id: row.id },
        body: { status: "completed" },
      });
    }
  });

  it("is not held up by the optional one still outstanding", async () => {
    const left = await withPlatform((db) =>
      db.checklistTask.count({ where: { employeeId: joinerId, status: "pending" } }),
    );
    expect(left).toBe(1);

    const result = await call(changeStatus, `/api/v1/employees/${joinerId}/status`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: joinerId },
      body: { status: "active" },
    });

    expect(result.status, result.error?.message).toBe(200);
  });
});

describe("what each person can see", () => {
  it("shows a manager the tasks about their own report", async () => {
    const result = await call<{ title: string; employee: { id: string } }[]>(
      getTasks,
      "/api/v1/checklist-tasks",
      { as: t.acme.manager },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((task) => task.employee.id === joinerId)).toBe(true);
  });

  it("shows an employee with no part in any checklist nothing at all", async () => {
    const result = await call<{ id: string }[]>(getTasks, "/api/v1/checklist-tasks", {
      as: t.acme.employee,
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual([]);
  });

  it("keeps one company's checklists out of another's", async () => {
    const result = await call<{ id: string }[]>(getTasks, "/api/v1/checklist-tasks", {
      as: t.globex.hr,
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual([]);
  });

  it("will not show another company's pipeline", async () => {
    const result = await call<unknown[]>(pipeline, "/api/v1/onboarding/pipeline", {
      as: t.globex.hr,
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual([]);
  });

  it("refuses the pipeline to an employee", async () => {
    const result = await call(pipeline, "/api/v1/onboarding/pipeline", { as: t.acme.employee });
    expect(result.status).toBe(403);
  });
});
