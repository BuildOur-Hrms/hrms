import { beforeAll, describe, expect, it } from "vitest";

import { POST as createTemplate } from "@/app/api/v1/checklist-templates/route";
import { GET as listExits, POST as resign } from "@/app/api/v1/offboarding/route";
import { POST as approve } from "@/app/api/v1/offboarding/[id]/approve/route";
import { POST as cancel } from "@/app/api/v1/offboarding/[id]/cancel/route";
import { POST as clear } from "@/app/api/v1/offboarding/[id]/clear/route";
import { POST as complete } from "@/app/api/v1/offboarding/[id]/complete/route";
import { POST as confirm } from "@/app/api/v1/offboarding/[id]/confirm/route";
import { POST as settlement } from "@/app/api/v1/offboarding/[id]/settlement/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * Leaving, end to end.
 *
 * The order is the whole point, so most of this is about what may not happen:
 * confirming before approval, clearing with tasks outstanding, approving your
 * own resignation, withdrawing after the money has been settled.
 */

let t: Tenants;

async function makeLeaver(code: string, managerId: string | null) {
  return withPlatform(async (db) => {
    const employee = await db.employee.create({
      data: {
        companyId: t.acme.companyId,
        employeeCode: code,
        firstName: "Sam",
        lastName: code,
        departmentId: t.acme.departmentId,
        designationId: t.acme.designationId,
        locationId: t.acme.locationId,
        managerId,
        employmentType: "full_time",
        status: "active",
        joinDate: new Date("2024-01-08"),
      },
      select: { id: true },
    });
    return employee.id;
  });
}

beforeAll(async () => {
  t = await seedTenants();

  await call(createTemplate, "/api/v1/checklist-templates", {
    as: t.acme.hr,
    method: "POST",
    body: {
      kind: "offboarding",
      name: "Standard exit",
      isDefault: true,
      tasks: [
        { title: "Return the laptop", assignee: "employee", dueOffsetDays: -1, sortOrder: 1 },
        { title: "Revoke access", assignee: "it", dueOffsetDays: 0, sortOrder: 2 },
        {
          title: "Exit interview",
          assignee: "hr",
          dueOffsetDays: -3,
          isRequired: false,
          sortOrder: 3,
        },
      ],
    },
  });
});

describe("resigning", () => {
  it("is something an employee does for themselves", async () => {
    const result = await call<{ id: string; status: string }>(resign, "/api/v1/offboarding", {
      as: t.acme.employee,
      method: "POST",
      body: { reason: "Moving on.", requestedLastWorkingDay: "2026-09-30" },
    });

    expect(result.status, result.error?.message).toBe(201);
    expect(result.data.status).toBe("initiated");
  });

  it("refuses a second one while the first is open", async () => {
    const result = await call(resign, "/api/v1/offboarding", {
      as: t.acme.employee,
      method: "POST",
      body: { reason: "Again.", requestedLastWorkingDay: "2026-10-30" },
    });

    expect(result.status).toBe(422);
  });

  it("will not let an employee file one for somebody else", async () => {
    const other = await makeLeaver("ACME-OTHER", null);
    const result = await call(resign, "/api/v1/offboarding", {
      as: t.acme.employee,
      method: "POST",
      body: {
        employeeId: other,
        reason: "Not mine to file.",
        requestedLastWorkingDay: "2026-09-30",
      },
    });

    expect(result.status).toBe(403);
  });
});

describe("the order it has to happen in", () => {
  let leaverId: string;
  let requestId: string;

  beforeAll(async () => {
    leaverId = await makeLeaver("ACME-LEAVER", t.acme.manager.employeeId);
    const result = await call<{ id: string }>(resign, "/api/v1/offboarding", {
      as: t.acme.hr,
      method: "POST",
      body: {
        employeeId: leaverId,
        reason: "Resigned in person.",
        requestedLastWorkingDay: "2026-09-10",
      },
    });
    requestId = result.data.id;
  });

  it("will not confirm before anybody has approved", async () => {
    const result = await call(confirm, `/api/v1/offboarding/${requestId}/confirm`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: requestId },
      body: {},
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/approved/i);
  });

  it("will not let somebody approve their own", async () => {
    const own = await call<{ id: string }>(resign, "/api/v1/offboarding", {
      as: t.acme.manager,
      method: "POST",
      body: { reason: "Mine.", requestedLastWorkingDay: "2026-11-30" },
    });

    const result = await call(approve, `/api/v1/offboarding/${own.data.id}/approve`, {
      as: t.acme.manager,
      method: "POST",
      params: { id: own.data.id },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/your own/i);
  });

  it("takes the manager's approval", async () => {
    const result = await call<{ approvedAt: string | null }>(
      approve,
      `/api/v1/offboarding/${requestId}/approve`,
      { as: t.acme.manager, method: "POST", params: { id: requestId } },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.approvedAt).not.toBeNull();
  });

  it("holds the last working day to the notice period", async () => {
    const result = await call<{ lastWorkingDay: string; status: string }>(
      confirm,
      `/api/v1/offboarding/${requestId}/confirm`,
      { as: t.acme.hr, method: "POST", params: { id: requestId }, body: {} },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("in_progress");
    // Asked for 2026-09-10; the company's 30 days from today is later, so the
    // request is a request and the notice period is the answer.
    const settled = result.data.lastWorkingDay.slice(0, 10);
    const thirtyDays = new Date();
    thirtyDays.setUTCDate(thirtyDays.getUTCDate() + 30);
    expect(settled).toBe(thirtyDays.toISOString().slice(0, 10));
  });

  it("puts them on notice and starts the exit checklist", async () => {
    const employee = await withPlatform((db) =>
      db.employee.findFirstOrThrow({ where: { id: leaverId }, select: { status: true } }),
    );
    expect(employee.status).toBe("on_notice");

    const tasks = await withPlatform((db) =>
      db.checklistTask.findMany({
        where: { employeeId: leaverId, kind: "offboarding" },
        orderBy: { sortOrder: "asc" },
        select: { title: true, offboardingRequestId: true },
      }),
    );
    expect(tasks.map((task) => task.title)).toEqual([
      "Return the laptop",
      "Revoke access",
      "Exit interview",
    ]);
    // Every exit task belongs to the exit that created it — the database
    // refuses one that does not.
    expect(tasks.every((task) => task.offboardingRequestId === requestId)).toBe(true);
  });

  it("will not clear while a required task is outstanding, and says which", async () => {
    const result = await call(clear, `/api/v1/offboarding/${requestId}/clear`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: requestId },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/Return the laptop/);
  });

  it("clears once the required tasks are settled, ignoring the optional one", async () => {
    const rows = await withPlatform((db) =>
      db.checklistTask.updateMany({
        where: { employeeId: leaverId, kind: "offboarding", isRequired: true },
        data: { status: "completed", completedAt: new Date() },
      }),
    );
    expect(rows.count).toBe(2);

    const result = await call<{ status: string }>(clear, `/api/v1/offboarding/${requestId}/clear`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: requestId },
    });

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("cleared");
  });

  it("will not complete before the settlement is recorded", async () => {
    const result = await call(complete, `/api/v1/offboarding/${requestId}/complete`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: requestId },
    });

    expect(result.status).toBe(422);
  });

  it("records what is owed rather than working it out", async () => {
    const result = await call<{ status: string; leaveEncashmentDays: string | number | null }>(
      settlement,
      `/api/v1/offboarding/${requestId}/settlement`,
      {
        as: t.acme.hr,
        method: "POST",
        params: { id: requestId },
        body: { leaveEncashmentDays: 4.5, settlementNotes: "Two months' bonus pending." },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("settled");
    expect(Number(result.data.leaveEncashmentDays)).toBe(4.5);
  });

  it("refuses to withdraw once money has been settled", async () => {
    const result = await call(cancel, `/api/v1/offboarding/${requestId}/cancel`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: requestId },
      body: { cancellationReason: "Changed their mind." },
    });

    expect(result.status).toBe(422);
  });

  it("finishes: the person has left, and the login stops working now", async () => {
    const result = await call<{ status: string }>(
      complete,
      `/api/v1/offboarding/${requestId}/complete`,
      { as: t.acme.hr, method: "POST", params: { id: requestId } },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("completed");

    const employee = await withPlatform((db) =>
      db.employee.findFirstOrThrow({
        where: { id: leaverId },
        select: { status: true, exitDate: true },
      }),
    );
    expect(employee.status).toBe("exited");
    expect(employee.exitDate).not.toBeNull();
  });
});

describe("closing the account", () => {
  it("disables the login and invalidates the session they left open", async () => {
    /*
     * The leaver above had no account, so the part that matters most was
     * never exercised: somebody walking out with a browser still signed in
     * somewhere. Bumping the session version is what stops that cookie now
     * rather than whenever it would have expired.
     */
    const leaverId = await makeLeaver("ACME-WITH-LOGIN", t.acme.manager.employeeId);
    const before = await withPlatform(async (db) => {
      const user = await db.user.create({
        data: { companyId: t.acme.companyId, email: "leaver@acme.test", status: "active" },
        select: { id: true, sessionVersion: true },
      });
      await db.employee.update({ where: { id: leaverId }, data: { userId: user.id } });
      return user;
    });

    const filed = await call<{ id: string }>(resign, "/api/v1/offboarding", {
      as: t.acme.hr,
      method: "POST",
      body: { employeeId: leaverId, reason: "Off.", requestedLastWorkingDay: "2026-12-31" },
    });
    const id = filed.data.id;

    await call(approve, `/api/v1/offboarding/${id}/approve`, {
      as: t.acme.manager,
      method: "POST",
      params: { id },
    });
    await call(confirm, `/api/v1/offboarding/${id}/confirm`, {
      as: t.acme.hr,
      method: "POST",
      params: { id },
      body: {},
    });
    await withPlatform((db) =>
      db.checklistTask.updateMany({
        where: { offboardingRequestId: id, isRequired: true },
        data: { status: "completed", completedAt: new Date() },
      }),
    );
    await call(clear, `/api/v1/offboarding/${id}/clear`, {
      as: t.acme.hr,
      method: "POST",
      params: { id },
    });
    await call(settlement, `/api/v1/offboarding/${id}/settlement`, {
      as: t.acme.hr,
      method: "POST",
      params: { id },
      body: {},
    });

    const result = await call(complete, `/api/v1/offboarding/${id}/complete`, {
      as: t.acme.hr,
      method: "POST",
      params: { id },
    });
    expect(result.status, result.error?.message).toBe(200);

    const after = await withPlatform((db) =>
      db.user.findFirstOrThrow({
        where: { id: before.id },
        select: { status: true, sessionVersion: true },
      }),
    );
    expect(after.status).toBe("disabled");
    expect(after.sessionVersion).toBeGreaterThan(before.sessionVersion);
  });
});

describe("withdrawing", () => {
  let leaverId: string;
  let requestId: string;

  beforeAll(async () => {
    leaverId = await makeLeaver("ACME-STAYS", t.acme.manager.employeeId);
    const filed = await call<{ id: string }>(resign, "/api/v1/offboarding", {
      as: t.acme.hr,
      method: "POST",
      body: {
        employeeId: leaverId,
        reason: "Thinking about it.",
        requestedLastWorkingDay: "2026-12-01",
      },
    });
    requestId = filed.data.id;

    await call(approve, `/api/v1/offboarding/${requestId}/approve`, {
      as: t.acme.manager,
      method: "POST",
      params: { id: requestId },
    });
    await call(confirm, `/api/v1/offboarding/${requestId}/confirm`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: requestId },
      body: {},
    });
  });

  it("needs a reason", async () => {
    const result = await call(cancel, `/api/v1/offboarding/${requestId}/cancel`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: requestId },
      body: { cancellationReason: "" },
    });

    expect(result.status).toBe(400);
  });

  it("puts them back to active and clears the exit tasks", async () => {
    const result = await call<{ status: string }>(
      cancel,
      `/api/v1/offboarding/${requestId}/cancel`,
      {
        as: t.acme.hr,
        method: "POST",
        params: { id: requestId },
        body: { cancellationReason: "They were talked out of it." },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("cancelled");

    const employee = await withPlatform((db) =>
      db.employee.findFirstOrThrow({ where: { id: leaverId }, select: { status: true } }),
    );
    expect(employee.status).toBe("active");

    const left = await withPlatform((db) =>
      db.checklistTask.count({ where: { offboardingRequestId: requestId, status: "pending" } }),
    );
    expect(left).toBe(0);
  });

  it("keeps the record, because it happened", async () => {
    const row = await withPlatform((db) =>
      db.offboardingRequest.findFirst({
        where: { id: requestId },
        select: { status: true, cancellationReason: true },
      }),
    );
    expect(row?.status).toBe("cancelled");
    expect(row?.cancellationReason).toMatch(/talked out of it/);
  });

  it("lets them resign again afterwards", async () => {
    const result = await call(resign, "/api/v1/offboarding", {
      as: t.acme.hr,
      method: "POST",
      body: {
        employeeId: leaverId,
        reason: "Really this time.",
        requestedLastWorkingDay: "2027-01-15",
      },
    });

    expect(result.status, result.error?.message).toBe(201);
  });
});

describe("who can see an exit", () => {
  it("shows the other tenant none of ours", async () => {
    const result = await call<unknown[]>(listExits, "/api/v1/offboarding", { as: t.globex.hr });
    expect(result.status).toBe(200);
    expect(result.data).toEqual([]);
  });

  it("shows an employee only their own", async () => {
    const result = await call<{ employee: { id: string } }[]>(listExits, "/api/v1/offboarding", {
      as: t.acme.employee,
    });

    expect(result.status).toBe(200);
    // Non-empty first: `every` over an empty list is true, and this test
    // would then pass for a scope that returned nothing at all.
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.employee.id === t.acme.employee.employeeId)).toBe(true);
  });
});
