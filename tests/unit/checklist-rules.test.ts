import { describe, expect, it } from "vitest";

import {
  canAdvance,
  dueDateFor,
  holderFor,
  lastWorkingDay,
  OFFBOARDING_NEXT,
  planTasks,
  progressOf,
  requiredTasksSettled,
  type OffboardingState,
  type RoleHolders,
  type TaskState,
  type TemplateTask,
} from "@/modules/checklists/rules";

/**
 * The checklist arithmetic, argued about here rather than in production.
 */

const ROLES: RoleHolders = {
  employeeId: "new-joiner",
  managerId: "the-manager",
  hrId: "the-hr-person",
  itId: null,
};

describe("when a task falls due", () => {
  it("counts forward from the anchor", () => {
    expect(dueDateFor("2026-03-02", 5)).toBe("2026-03-07");
  });

  it("counts backward, which is the normal case on the way out", () => {
    expect(dueDateFor("2026-03-02", -3)).toBe("2026-02-27");
  });

  it("lands on the anchor itself at zero", () => {
    expect(dueDateFor("2026-03-02", 0)).toBe("2026-03-02");
  });

  it("crosses a month end", () => {
    expect(dueDateFor("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("crosses a year end", () => {
    expect(dueDateFor("2026-12-30", 5)).toBe("2027-01-04");
  });

  it("knows February has 29 days in a leap year", () => {
    expect(dueDateFor("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("does not drift across a daylight-saving boundary", () => {
    // Dates, not moments. A day that shifts by an hour must not become the
    // day before — which is exactly what local-time arithmetic does here.
    expect(dueDateFor("2026-03-28", 1)).toBe("2026-03-29");
    expect(dueDateFor("2026-10-24", 1)).toBe("2026-10-25");
  });
});

describe("who owes a task", () => {
  it("gives the person themselves their own tasks", () => {
    expect(holderFor("employee", ROLES)).toBe("new-joiner");
  });

  it("finds the manager and the HR person", () => {
    expect(holderFor("manager", ROLES)).toBe("the-manager");
    expect(holderFor("hr", ROLES)).toBe("the-hr-person");
  });

  it("answers nobody where nobody fills the role", () => {
    // A company with no IT contact still gets the task; it simply waits on a
    // role rather than a person.
    expect(holderFor("it", ROLES)).toBeNull();
  });

  it("answers nobody for a joiner with no manager", () => {
    expect(holderFor("manager", { ...ROLES, managerId: null })).toBeNull();
  });
});

describe("planning a checklist", () => {
  const template: TemplateTask[] = [
    {
      title: "Sign the contract",
      assignee: "employee",
      dueOffsetDays: 0,
      isRequired: true,
      sortOrder: 2,
    },
    { title: "Laptop ready", assignee: "it", dueOffsetDays: -2, isRequired: true, sortOrder: 1 },
    { title: "Team lunch", assignee: "manager", dueOffsetDays: 7, isRequired: false, sortOrder: 3 },
  ];

  it("keeps the template's own order", () => {
    const plan = planTasks(template, "2026-03-02", ROLES);
    expect(plan.map((task) => task.title)).toEqual([
      "Laptop ready",
      "Sign the contract",
      "Team lunch",
    ]);
  });

  it("dates each task from the anchor", () => {
    const plan = planTasks(template, "2026-03-02", ROLES);
    expect(plan.map((task) => task.dueDate)).toEqual(["2026-02-28", "2026-03-02", "2026-03-09"]);
  });

  it("resolves each role to a person, or to nobody", () => {
    const plan = planTasks(template, "2026-03-02", ROLES);
    expect(plan.map((task) => task.assignedToEmployeeId)).toEqual([
      null, // no IT contact
      "new-joiner",
      "the-manager",
    ]);
  });

  it("does not disturb the template it was given", () => {
    const order = template.map((task) => task.title);
    planTasks(template, "2026-03-02", ROLES);
    expect(template.map((task) => task.title)).toEqual(order);
  });
});

describe("progress", () => {
  const tasks: TaskState[] = [
    { isRequired: true, status: "completed", dueDate: "2026-03-01" },
    { isRequired: true, status: "skipped", dueDate: "2026-03-01" },
    { isRequired: true, status: "pending", dueDate: "2026-03-01" },
    { isRequired: false, status: "pending", dueDate: "2026-03-20" },
  ];

  it("counts a skipped task as settled", () => {
    // Somebody looked at it and decided, with a reason recorded. Counting it
    // as outstanding would park every checklist just short of finished.
    expect(progressOf(tasks, "2026-03-10").done).toBe(2);
  });

  it("counts only required pending tasks as blocking", () => {
    expect(progressOf(tasks, "2026-03-10").blocking).toBe(1);
  });

  it("counts overdue by the day, ignoring what is already settled", () => {
    expect(progressOf(tasks, "2026-03-10").overdue).toBe(1);
  });

  it("does not call a task due today overdue", () => {
    expect(progressOf(tasks, "2026-03-01").overdue).toBe(0);
  });

  it("calls an empty checklist finished rather than dividing by zero", () => {
    expect(progressOf([], "2026-03-10")).toMatchObject({ total: 0, percent: 100 });
  });

  it("reports a percentage of everything, not only what is required", () => {
    expect(progressOf(tasks, "2026-03-10").percent).toBe(50);
  });
});

describe("the gate", () => {
  it("stays shut while a required task is pending", () => {
    expect(requiredTasksSettled([{ isRequired: true, status: "pending", dueDate: null }])).toBe(
      false,
    );
  });

  it("opens once every required task is done or skipped", () => {
    expect(
      requiredTasksSettled([
        { isRequired: true, status: "completed", dueDate: null },
        { isRequired: true, status: "skipped", dueDate: null },
      ]),
    ).toBe(true);
  });

  it("is never held by an optional task", () => {
    expect(requiredTasksSettled([{ isRequired: false, status: "pending", dueDate: null }])).toBe(
      true,
    );
  });

  it("opens on an empty checklist", () => {
    expect(requiredTasksSettled([])).toBe(true);
  });
});

describe("moving an exit along", () => {
  it("follows the order", () => {
    expect(canAdvance("initiated", "in_progress")).toBe(true);
    expect(canAdvance("in_progress", "cleared")).toBe(true);
    expect(canAdvance("cleared", "settled")).toBe(true);
    expect(canAdvance("settled", "completed")).toBe(true);
  });

  it("refuses to skip a step", () => {
    expect(canAdvance("initiated", "cleared")).toBe(false);
    expect(canAdvance("in_progress", "completed")).toBe(false);
  });

  it("refuses to go back", () => {
    expect(canAdvance("cleared", "in_progress")).toBe(false);
  });

  it("allows withdrawal while the person is still here", () => {
    expect(canAdvance("initiated", "cancelled")).toBe(true);
    expect(canAdvance("in_progress", "cancelled")).toBe(true);
    expect(canAdvance("cleared", "cancelled")).toBe(true);
  });

  it("refuses to cancel once money has moved", () => {
    // Undoing a settlement is another payment, not a status change.
    expect(canAdvance("settled", "cancelled")).toBe(false);
  });

  const terminal: OffboardingState[] = ["completed", "cancelled"];

  it.each(terminal)("treats %s as final, with nothing after it", (state) => {
    // Each state checked on its own. `every(...)` over the pair would be
    // satisfied by one of them being right, which is not the claim.
    expect(OFFBOARDING_NEXT[state]).toEqual([]);
    expect(canAdvance(state, "in_progress")).toBe(false);
    expect(canAdvance(state, "completed")).toBe(false);
  });
});

describe("the last working day", () => {
  it("is the day notice runs out when somebody offers less", () => {
    expect(lastWorkingDay("2026-03-01", "2026-03-15", 30)).toBe("2026-03-31");
  });

  it("is the day they asked for when that is later", () => {
    expect(lastWorkingDay("2026-03-01", "2026-05-01", 30)).toBe("2026-05-01");
  });

  it("is the day they asked for when the company has no notice period", () => {
    expect(lastWorkingDay("2026-03-01", "2026-03-05", 0)).toBe("2026-03-05");
  });
});
