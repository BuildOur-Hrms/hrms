import { beforeAll, describe, expect, it } from "vitest";

import { POST as punch } from "@/app/api/v1/attendance/punch/route";
import { GET as listLocks, POST as setLock } from "@/app/api/v1/attendance/locks/route";
import { GET as getAuditLogs } from "@/app/api/v1/audit-logs/route";
import { POST as createDepartment } from "@/app/api/v1/departments/route";
import { POST as createEmployee } from "@/app/api/v1/employees/route";
import { POST as reviewLeave } from "@/app/api/v1/leave/requests/[id]/review/route";
import { POST as createLeaveRequest } from "@/app/api/v1/leave/requests/route";
import { GET as listRoles } from "@/app/api/v1/roles/route";
import { GET as listSettings } from "@/app/api/v1/settings/route";
import { GET as listUsers } from "@/app/api/v1/users/route";
import { ROLE_PERMISSIONS, type PermissionCode, type SystemRole } from "@/lib/permissions";

import { call, seedTenants, type CallOptions, type Tenant, type Tenants } from "./harness";

/**
 * The permission matrix, run for real (docs/10-roadmap-testing-deployment.md §3).
 *
 * `tests/unit/permission-matrix.test.ts` proves the grid the code *declares*.
 * This proves the grid the server *enforces*, by calling each endpoint as all
 * four roles and checking the answer against the same role matrix.
 *
 * The assertion is deliberately asymmetric. A role without the permission must
 * get exactly 403 — no other status is acceptable, because 404 or 422 would
 * mean the request got far enough to touch data. A role with it must get
 * anything except 403; the fixtures are not built to make every write succeed,
 * and "did the authorization layer let this through" is the question here.
 */

const ROLES: SystemRole[] = ["super_admin", "hr_admin", "manager", "employee"];

interface Case {
  name: string;
  permission: PermissionCode;
  handler: Parameters<typeof call>[0];
  path: string;
  options?: (t: Tenant) => CallOptions;
}

const CASES: Case[] = [
  {
    name: "GET /audit-logs",
    permission: "audit.view_all",
    handler: getAuditLogs,
    path: "/api/v1/audit-logs",
  },
  { name: "GET /users", permission: "users.view_all", handler: listUsers, path: "/api/v1/users" },
  { name: "GET /roles", permission: "roles.view_all", handler: listRoles, path: "/api/v1/roles" },
  {
    name: "GET /settings",
    permission: "settings.manage",
    handler: listSettings,
    path: "/api/v1/settings",
  },
  {
    name: "GET /attendance/locks",
    permission: "attendance.view_all",
    handler: listLocks,
    path: "/api/v1/attendance/locks",
    options: () => ({ query: { year: 2026 } }),
  },
  {
    name: "POST /attendance/locks",
    permission: "attendance.manage",
    handler: setLock,
    path: "/api/v1/attendance/locks",
    options: () => ({ body: { year: 2026, month: 1, action: "lock" } }),
  },
  {
    name: "POST /attendance/punch",
    permission: "attendance.create",
    handler: punch,
    path: "/api/v1/attendance/punch",
    options: () => ({ body: { direction: "in" } }),
  },
  {
    name: "POST /departments",
    permission: "department.manage",
    handler: createDepartment,
    path: "/api/v1/departments",
    options: () => ({
      body: { name: `Dept ${Math.random().toString(36).slice(2, 8)}`, code: "D1" },
    }),
  },
  {
    name: "POST /employees",
    permission: "employee.create",
    handler: createEmployee,
    path: "/api/v1/employees",
    options: (t) => ({
      body: {
        employeeCode: `E-${Math.random().toString(36).slice(2, 8)}`,
        firstName: "New",
        departmentId: t.departmentId,
        designationId: t.designationId,
        locationId: t.locationId,
        employmentType: "full_time",
        joinDate: "2026-01-01",
      },
    }),
  },
  {
    name: "POST /leave/requests",
    permission: "leave.create",
    handler: createLeaveRequest,
    path: "/api/v1/leave/requests",
    options: (t) => ({
      body: {
        leaveTypeId: t.leaveTypeId,
        startDate: "2026-09-01",
        endDate: "2026-09-01",
        reason: "Personal errand",
      },
    }),
  },
  {
    name: "POST /leave/requests/:id/review",
    permission: "leave.approve",
    handler: reviewLeave,
    path: "/api/v1/leave/requests/00000000-0000-0000-0000-000000000000/review",
    options: () => ({
      params: { id: "00000000-0000-0000-0000-000000000000" },
      body: { decision: "approved" },
    }),
  },
];

let t: Tenants;

beforeAll(async () => {
  t = await seedTenants();
});

describe("every endpoint, every role", () => {
  for (const testCase of CASES) {
    for (const role of ROLES) {
      const holds = ROLE_PERMISSIONS[role].includes(testCase.permission);

      it(`${testCase.name} — ${role} ${holds ? "may" : "may not"}`, async () => {
        const persona =
          role === "super_admin"
            ? t.acme.superAdmin
            : role === "hr_admin"
              ? t.acme.hr
              : role === "manager"
                ? t.acme.manager
                : t.acme.employee;

        const result = await call(testCase.handler, testCase.path, {
          ...(testCase.options?.(t.acme) ?? {}),
          as: persona,
        });

        if (holds) {
          expect(result.status, `${testCase.name} as ${role}: ${result.error?.message}`).not.toBe(
            403,
          );
        } else {
          expect(result.status, `${testCase.name} as ${role}`).toBe(403);
          expect(result.error?.code).toBe("FORBIDDEN");
        }
      });
    }
  }
});

describe("a session from another company", () => {
  it("cannot borrow this company's permissions", async () => {
    // A valid, correctly signed cookie — for the wrong tenant. The claims
    // carry the company, so this resolves into globex and sees globex data,
    // never acme's, however privileged the role.
    const result = await call<{ id: string }[]>(getAuditLogs, "/api/v1/audit-logs", {
      as: t.globex.superAdmin,
    });

    expect(result.status).toBe(200);
    const acmeRows = await call<{ id: string }[]>(getAuditLogs, "/api/v1/audit-logs", {
      as: t.acme.superAdmin,
    });
    const mine = new Set(acmeRows.data.map((r) => r.id));
    for (const row of result.data) expect(mine.has(row.id)).toBe(false);
  });
});
