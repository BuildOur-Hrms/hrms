import { beforeAll, describe, expect, it } from "vitest";

import { GET as getAuditLogs } from "@/app/api/v1/audit-logs/route";
import { GET as listDepartments } from "@/app/api/v1/departments/route";
import { GET as listEmployees, POST as createEmployee } from "@/app/api/v1/employees/route";
import {
  GET as getEmployee,
  PATCH as updateEmployee,
  DELETE as deleteEmployee,
} from "@/app/api/v1/employees/[id]/route";
import { GET as listLeaveTypes } from "@/app/api/v1/leave-types/route";
import { GET as runReport } from "@/app/api/v1/reports/[slug]/route";
import { GET as listShifts } from "@/app/api/v1/shifts/route";
import { withTenant } from "@/lib/db";

import { call, rlsEnforced, seedTenants, type Tenants } from "./harness";

/**
 * Tenant isolation (docs/09-security.md §4, docs/10-… §3).
 *
 * The interesting question is never "can I read my own data". It is "can I
 * read theirs", and it is asked here of both layers at once: the Prisma
 * extension that injects `company_id`, and the row-level security that
 * assumes the extension will one day be wrong.
 *
 * A foreign id must come back 404 and not 403. A 403 confirms the row exists,
 * which is itself a leak — an attacker enumerating ids learns the shape of
 * another company's database from the difference.
 */

let t: Tenants;

/**
 * Resolved before the suite is defined, so the database-layer block can be
 * skipped rather than quietly passing on a connection that ignores policies.
 */
const enforced = await rlsEnforced();

beforeAll(async () => {
  t = await seedTenants();
});

describe("lists never cross the tenant boundary", () => {
  it("shows only the caller's own employees", async () => {
    const acme = await call<{ id: string }[]>(listEmployees, "/api/v1/employees", {
      as: t.acme.hr,
    });
    const globex = await call<{ id: string }[]>(listEmployees, "/api/v1/employees", {
      as: t.globex.hr,
    });

    expect(acme.status).toBe(200);
    expect(globex.status).toBe(200);

    const acmeIds = new Set(acme.data.map((e) => e.id));
    for (const employee of globex.data) {
      expect(acmeIds.has(employee.id)).toBe(false);
    }
    expect(acme.data.length).toBeGreaterThan(0);
  });

  it("shows only the caller's own reference data", async () => {
    const cases: [string, typeof listDepartments][] = [
      ["/api/v1/departments", listDepartments],
      ["/api/v1/leave-types", listLeaveTypes],
      ["/api/v1/shifts", listShifts],
    ];

    for (const [path, handler] of cases) {
      const acme = await call<{ id: string }[]>(handler, path, { as: t.acme.hr });
      const globex = await call<{ id: string }[]>(handler, path, { as: t.globex.hr });

      const rows = Array.isArray(acme.data) ? acme.data : [];
      const theirs = Array.isArray(globex.data) ? globex.data : [];
      expect(rows.length, path).toBeGreaterThan(0);

      const mine = new Set(rows.map((r) => r.id));
      for (const row of theirs) expect(mine.has(row.id), path).toBe(false);
    }
  });

  it("keeps one company's audit trail out of the other's viewer", async () => {
    const acme = await call<{ id: string }[]>(getAuditLogs, "/api/v1/audit-logs", {
      as: t.acme.superAdmin,
    });
    const globex = await call<{ id: string }[]>(getAuditLogs, "/api/v1/audit-logs", {
      as: t.globex.superAdmin,
    });

    expect(acme.status).toBe(200);
    const mine = new Set(acme.data.map((r) => r.id));
    for (const row of globex.data) expect(mine.has(row.id)).toBe(false);
  });

  it("scopes a report to the running company", async () => {
    const acme = await call<{ id: string }[]>(runReport, "/api/v1/reports/headcount", {
      as: t.acme.hr,
      params: { slug: "headcount" },
    });
    const globex = await call<{ id: string }[]>(runReport, "/api/v1/reports/headcount", {
      as: t.globex.hr,
      params: { slug: "headcount" },
    });

    expect(acme.status).toBe(200);
    expect(acme.data.length).toBeGreaterThan(0);

    const mine = new Set(acme.data.map((r) => r.id));
    for (const row of globex.data) expect(mine.has(row.id)).toBe(false);
  });
});

describe("a foreign id is a 404, not a 403", () => {
  it("hides a read", async () => {
    const result = await call(getEmployee, `/api/v1/employees/${t.globex.employee.employeeId}`, {
      as: t.acme.hr,
      params: { id: t.globex.employee.employeeId },
    });

    expect(result.status).toBe(404);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("hides an update", async () => {
    const result = await call(updateEmployee, `/api/v1/employees/${t.globex.employee.employeeId}`, {
      as: t.acme.hr,
      method: "PATCH",
      params: { id: t.globex.employee.employeeId },
      body: { phone: "9999999999" },
    });

    expect(result.status).toBe(404);
  });

  it("hides a delete", async () => {
    const result = await call(deleteEmployee, `/api/v1/employees/${t.globex.employee.employeeId}`, {
      as: t.acme.hr,
      method: "DELETE",
      params: { id: t.globex.employee.employeeId },
    });

    expect(result.status).toBe(404);
  });

  it("leaves the record untouched after all of that", async () => {
    const survived = await call<{ phone: string | null }>(
      getEmployee,
      `/api/v1/employees/${t.globex.employee.employeeId}`,
      { as: t.globex.hr, params: { id: t.globex.employee.employeeId } },
    );

    expect(survived.status).toBe(200);
    expect(survived.data.phone).not.toBe("9999999999");
  });
});

describe("a foreign reference cannot be smuggled in through a body", () => {
  it("refuses to create an employee into another company's department", async () => {
    const result = await call(createEmployee, "/api/v1/employees", {
      as: t.acme.hr,
      body: {
        employeeCode: "SMUGGLED",
        firstName: "Smuggled",
        departmentId: t.globex.departmentId,
        designationId: t.acme.designationId,
        locationId: t.acme.locationId,
        employmentType: "full_time",
        joinDate: "2026-01-01",
      },
    });

    // Whether the guard is the service's existence check or the database's
    // foreign key, the row must not be created and the answer must not
    // confirm that the department exists somewhere.
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });
});

describe.skipIf(!enforced)("row-level security, underneath the application", () => {
  it("returns zero foreign rows to a raw query in a tenant transaction", async () => {
    const rows = await withTenant(t.acme.companyId, (db) =>
      db.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*)::bigint AS count FROM employees WHERE company_id = '${t.globex.companyId}'`,
      ),
    );

    expect(Number(rows[0]?.count ?? -1)).toBe(0);
  });

  it("sees only its own company row", async () => {
    const rows = await withTenant(t.acme.companyId, (db) =>
      db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM companies`),
    );

    expect(rows.map((r) => r.id)).toEqual([t.acme.companyId]);
  });

  it("cannot update another company's rows even with raw SQL", async () => {
    await withTenant(t.acme.companyId, (db) =>
      db.$executeRawUnsafe(
        `UPDATE employees SET first_name = 'pwned' WHERE company_id = '${t.globex.companyId}'`,
      ),
    );

    const untouched = await withTenant(t.globex.companyId, (db) =>
      db.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*)::bigint AS count FROM employees WHERE first_name = 'pwned'`,
      ),
    );

    expect(Number(untouched[0]?.count ?? -1)).toBe(0);
  });
});

describe("without a session", () => {
  it("refuses every authenticated endpoint", async () => {
    const result = await call(listEmployees, "/api/v1/employees");
    expect(result.status).toBe(401);
  });
});
