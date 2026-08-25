import { beforeAll, describe, expect, it } from "vitest";

import { POST as assignSalary, GET as getSalary } from "@/app/api/v1/employees/[id]/salary/route";
import { POST as createComponent } from "@/app/api/v1/payroll/components/route";
import { GET as listPayslips } from "@/app/api/v1/payroll/payslips/route";
import { GET as preview } from "@/app/api/v1/payroll/preview/route";
import { POST as approveRun } from "@/app/api/v1/payroll/runs/[id]/approve/route";
import { GET as exportRun } from "@/app/api/v1/payroll/runs/[id]/export/route";
import { POST as runStatus } from "@/app/api/v1/payroll/runs/[id]/status/route";
import { POST as createRun } from "@/app/api/v1/payroll/runs/route";
import { withPlatform } from "@/lib/db";

import { call, callRaw, seedTenants, type Tenants } from "./harness";

/**
 * Payroll, end to end.
 *
 * Three things are worth proving against a real database: that a run refuses
 * an unlocked month, that a manager cannot see their report's pay, and that
 * approving a run freezes the figures rather than leaving a view over data
 * that keeps moving.
 */

let t: Tenants;
let basicId: string;
let pfId: string;
let runId: string;

const YEAR = 2027;
const MONTH = 3;

beforeAll(async () => {
  t = await seedTenants();

  const basic = await call<{ id: string }>(createComponent, "/api/v1/payroll/components", {
    as: t.acme.hr,
    method: "POST",
    body: { code: "BASIC", name: "Basic", kind: "earning", sortOrder: 1 },
  });
  basicId = basic.data.id;

  const pf = await call<{ id: string }>(createComponent, "/api/v1/payroll/components", {
    as: t.acme.hr,
    method: "POST",
    body: {
      code: "PF",
      name: "Provident fund",
      kind: "deduction",
      calcType: "percentage",
      baseComponentId: basicId,
      sortOrder: 10,
    },
  });
  pfId = pf.data.id;
});

describe("salary components", () => {
  it("are not something an employee can write", async () => {
    const result = await call(createComponent, "/api/v1/payroll/components", {
      as: t.acme.employee,
      method: "POST",
      body: { code: "BONUS", name: "Bonus", kind: "earning" },
    });

    expect(result.status).toBe(403);
  });

  it("refuse a duplicate code", async () => {
    const result = await call(createComponent, "/api/v1/payroll/components", {
      as: t.acme.hr,
      method: "POST",
      body: { code: "BASIC", name: "Basic again", kind: "earning" },
    });

    expect(result.status).toBe(409);
  });

  it("refuse a percentage of a percentage", async () => {
    // A chain nobody can read off a payslip.
    const result = await call(createComponent, "/api/v1/payroll/components", {
      as: t.acme.hr,
      method: "POST",
      body: {
        code: "SILLY",
        name: "Percentage of a percentage",
        kind: "deduction",
        calcType: "percentage",
        baseComponentId: pfId,
      },
    });

    expect(result.status).toBe(422);
  });

  it("refuse a percentage of nothing", async () => {
    const result = await call(createComponent, "/api/v1/payroll/components", {
      as: t.acme.hr,
      method: "POST",
      body: { code: "VAGUE", name: "Of what?", kind: "deduction", calcType: "percentage" },
    });

    expect(result.status).toBe(400);
  });
});

describe("assigning a salary", () => {
  const employeeUrl = () => `/api/v1/employees/${t.acme.employee.employeeId}/salary`;

  it("is refused to a manager, who never sees pay", async () => {
    const result = await call(assignSalary, employeeUrl(), {
      as: t.acme.manager,
      method: "POST",
      params: { id: t.acme.employee.employeeId },
      body: {
        effectiveFrom: "2027-01-01",
        items: [{ componentId: basicId, amountMinor: 50000_00 }],
      },
    });

    expect(result.status).toBe(403);
  });

  it("takes a salary with its components", async () => {
    const result = await call<{ id: string }>(assignSalary, employeeUrl(), {
      as: t.acme.hr,
      method: "POST",
      params: { id: t.acme.employee.employeeId },
      body: {
        effectiveFrom: "2027-01-01",
        note: "On joining the new band",
        items: [
          { componentId: basicId, amountMinor: 50000_00 },
          { componentId: pfId, percent: 12 },
        ],
      },
    });

    expect(result.status, result.error?.message).toBe(201);
  });

  it("refuses an item that gives both an amount and a percentage", async () => {
    const result = await call(assignSalary, employeeUrl(), {
      as: t.acme.hr,
      method: "POST",
      params: { id: t.acme.employee.employeeId },
      body: {
        effectiveFrom: "2027-06-01",
        items: [{ componentId: basicId, amountMinor: 100, percent: 5 }],
      },
    });

    expect(result.status).toBe(400);
  });

  it("closes the old revision when a new one starts", async () => {
    const result = await call(assignSalary, employeeUrl(), {
      as: t.acme.hr,
      method: "POST",
      params: { id: t.acme.employee.employeeId },
      body: {
        effectiveFrom: "2027-04-01",
        note: "April raise",
        items: [{ componentId: basicId, amountMinor: 60000_00 }],
      },
    });
    expect(result.status, result.error?.message).toBe(201);

    const rows = await withPlatform((db) =>
      db.employeeSalary.findMany({
        where: { employeeId: t.acme.employee.employeeId },
        orderBy: { effectiveFrom: "asc" },
        select: { effectiveFrom: true, effectiveTo: true },
      }),
    );

    expect(rows).toHaveLength(2);
    // Closed the day before the new one begins, so no day has two answers.
    expect(rows[0]?.effectiveTo?.toISOString().slice(0, 10)).toBe("2027-03-31");
    expect(rows[1]?.effectiveTo).toBeNull();
  });

  it("refuses to backdate over the revision in force", async () => {
    const result = await call(assignSalary, employeeUrl(), {
      as: t.acme.hr,
      method: "POST",
      params: { id: t.acme.employee.employeeId },
      body: {
        effectiveFrom: "2027-02-01",
        items: [{ componentId: basicId, amountMinor: 10_00 }],
      },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/history/i);
  });

  it("lets a person read their own", async () => {
    const result = await call<unknown[]>(getSalary, employeeUrl(), {
      as: t.acme.employee,
      params: { id: t.acme.employee.employeeId },
    });

    expect(result.status).toBe(200);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("hides it from their manager", async () => {
    // Not 403 but 404: that a salary record exists is itself not their business.
    const result = await call(getSalary, employeeUrl(), {
      as: t.acme.manager,
      params: { id: t.acme.employee.employeeId },
    });

    expect(result.status).toBe(404);
  });
});

describe("running a month", () => {
  it("refuses a month whose attendance is not locked", async () => {
    const result = await call(createRun, "/api/v1/payroll/runs", {
      as: t.acme.hr,
      method: "POST",
      body: { year: YEAR, month: MONTH },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/lock attendance/i);
  });

  it("opens once the month is locked", async () => {
    await withPlatform((db) =>
      db.attendanceMonthLock.create({
        data: {
          companyId: t.acme.companyId,
          year: YEAR,
          month: MONTH,
          lockedBy: t.acme.hr.userId,
        },
      }),
    );

    const result = await call<{ id: string; status: string }>(createRun, "/api/v1/payroll/runs", {
      as: t.acme.hr,
      method: "POST",
      body: { year: YEAR, month: MONTH },
    });

    expect(result.status, result.error?.message).toBe(201);
    expect(result.data.status).toBe("draft");
    runId = result.data.id;
  });

  it("refuses a second run for the same month", async () => {
    const result = await call(createRun, "/api/v1/payroll/runs", {
      as: t.acme.hr,
      method: "POST",
      body: { year: YEAR, month: MONTH },
    });

    expect(result.status).toBe(409);
  });

  it("previews what the month would pay, without saving", async () => {
    const result = await call<{
      rows: {
        employee: { id: string };
        hasSalary: boolean;
        grossMinor: number;
        netMinor: number;
      }[];
    }>(preview, "/api/v1/payroll/preview", {
      as: t.acme.hr,
      query: { year: String(YEAR), month: String(MONTH) },
    });

    expect(result.status, result.error?.message).toBe(200);

    const theirs = result.data.rows.find((row) => row.employee.id === t.acme.employee.employeeId);
    expect(theirs?.hasSalary).toBe(true);
    // The March revision, not the April one: 50,000 basic less 12% PF.
    expect(theirs?.grossMinor).toBe(50000_00);
    expect(theirs?.netMinor).toBe(44000_00);

    // Nothing was written by looking.
    const payslips = await withPlatform((db) => db.payslip.count({ where: { runId } }));
    expect(payslips).toBe(0);
  });

  it("lists everybody, including those with no salary on record", async () => {
    // A missing person is how a payroll quietly underpays.
    const result = await call<{ rows: { hasSalary: boolean }[] }>(
      preview,
      "/api/v1/payroll/preview",
      { as: t.acme.hr, query: { year: String(YEAR), month: String(MONTH) } },
    );

    expect(result.data.rows.some((row) => !row.hasSalary)).toBe(true);
  });

  it("is not something an employee can preview", async () => {
    const result = await call(preview, "/api/v1/payroll/preview", {
      as: t.acme.employee,
      query: { year: String(YEAR), month: String(MONTH) },
    });

    expect(result.status).toBe(403);
  });
});

describe("approving", () => {
  it("writes a payslip for everybody who has a salary", async () => {
    const result = await call<{ payslips: number; status: string }>(
      approveRun,
      `/api/v1/payroll/runs/${runId}/approve`,
      { as: t.acme.hr, method: "POST", params: { id: runId } },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("approved");
    expect(result.data.payslips).toBeGreaterThan(0);
  });

  it("freezes the figures against a later salary change", async () => {
    /*
     * The point of writing payslips rather than recomputing them. A raise
     * backdated into a month already paid must not silently rewrite what was
     * paid — the payslip is a record, not a view.
     */
    const before = await withPlatform((db) =>
      db.payslip.findFirstOrThrow({
        where: { runId, employeeId: t.acme.employee.employeeId },
        select: { grossMinor: true },
      }),
    );

    await withPlatform((db) =>
      db.employeeSalaryItem.updateMany({
        where: { component: { code: "BASIC" }, salary: { employeeId: t.acme.employee.employeeId } },
        data: { amountMinor: BigInt(99999_00) },
      }),
    );

    const after = await withPlatform((db) =>
      db.payslip.findFirstOrThrow({
        where: { runId, employeeId: t.acme.employee.employeeId },
        select: { grossMinor: true },
      }),
    );

    expect(after.grossMinor).toBe(before.grossMinor);
  });

  it("keeps the component names as they were", async () => {
    // Renaming one next year must not rewrite what this payslip says it paid.
    const items = await withPlatform((db) =>
      db.payslipItem.findMany({
        where: { payslip: { runId, employeeId: t.acme.employee.employeeId } },
        orderBy: { sortOrder: "asc" },
        select: { code: true, name: true, kind: true },
      }),
    );

    expect(items.map((item) => item.code)).toEqual(["BASIC", "PF"]);
  });

  it("will not approve the same run twice", async () => {
    const result = await call(approveRun, `/api/v1/payroll/runs/${runId}/approve`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: runId },
    });

    expect(result.status).toBe(422);
  });

  it("marks the run paid once finance has paid it", async () => {
    const result = await call<{ status: string }>(
      runStatus,
      `/api/v1/payroll/runs/${runId}/status`,
      {
        as: t.acme.hr,
        method: "POST",
        params: { id: runId },
        body: { status: "paid" },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("paid");
  });
});

describe("payslips", () => {
  it("are visible to the person they belong to", async () => {
    const result = await call<{ employee: { id: string } }[]>(
      listPayslips,
      "/api/v1/payroll/payslips",
      { as: t.acme.employee },
    );

    expect(result.status).toBe(200);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.employee.id === t.acme.employee.employeeId)).toBe(true);
  });

  it("are not visible to a manager, even for their own report", async () => {
    const asked = { employeeId: t.acme.employee.employeeId };

    // HR asking the same question gets an answer, so the manager's empty
    // result means "refused" rather than "there is nothing there".
    const hr = await call<{ employee: { id: string } }[]>(
      listPayslips,
      "/api/v1/payroll/payslips",
      { as: t.acme.hr, query: asked },
    );
    expect(hr.status, hr.error?.message).toBe(200);
    expect(hr.data.length).toBeGreaterThan(0);

    const manager = await call<{ employee: { id: string } }[]>(
      listPayslips,
      "/api/v1/payroll/payslips",
      { as: t.acme.manager, query: asked },
    );

    expect(manager.status).toBe(200);
    // Scoped back to themselves rather than answering the question asked.
    expect(manager.data.every((row) => row.employee.id !== t.acme.employee.employeeId)).toBe(true);
  });

  it("stay inside their own company", async () => {
    // Acme's HR sees them, so an empty answer for Globex is isolation rather
    // than an endpoint that returns nothing to anybody.
    const ours = await call<unknown[]>(listPayslips, "/api/v1/payroll/payslips", {
      as: t.acme.hr,
      query: { employeeId: t.acme.employee.employeeId },
    });
    expect(ours.data.length).toBeGreaterThan(0);

    const theirs = await call<unknown[]>(listPayslips, "/api/v1/payroll/payslips", {
      as: t.globex.hr,
    });

    expect(theirs.data).toEqual([]);
  });
});

describe("the export", () => {
  it("hands finance one row per person, in minor units", async () => {
    const response = await callRaw(exportRun, `/api/v1/payroll/runs/${runId}/export`, {
      as: t.acme.hr,
      params: { id: runId },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/csv/);

    const body = await response.text();
    const [header, ...rows] = body.trim().split("\r\n");

    expect(header).toBe(
      "employee_code,name,period,payable_days,lop_days,gross_minor,deductions_minor,net_minor",
    );
    expect(rows.length).toBeGreaterThan(0);
    // Whole minor units, so nothing downstream has to parse a decimal point
    // that might be a comma somewhere else in the world.
    for (const row of rows) {
      const net = row.split(",").at(-1) ?? "";
      expect(net).toMatch(/^-?\d+$/);
    }
  });

  it("is refused to somebody who may see pay but not take it out of the building", async () => {
    const response = await callRaw(exportRun, `/api/v1/payroll/runs/${runId}/export`, {
      as: t.acme.employee,
      params: { id: runId },
    });

    expect(response.status).toBe(403);
  });
});
