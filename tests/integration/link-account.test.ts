import { beforeAll, describe, expect, it } from "vitest";

import { GET as accountOptions } from "@/app/api/v1/employees/account-options/route";
import { GET as unlinkedOptions } from "@/app/api/v1/employees/unlinked-options/route";
import { POST as createEmployee } from "@/app/api/v1/employees/route";
import { POST as inviteUser } from "@/app/api/v1/users/invite/route";
import { POST as linkAccount } from "@/app/api/v1/employees/[id]/link-account/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * Connecting a login that exists to a person who exists.
 *
 * The case this is for: somebody invited directly holds an account with no
 * employee record, and `inviteUser` refuses an account that is already
 * active — so before this there was no way to connect the two, and the person
 * was told to ask an HR team who had nothing to click.
 *
 * The rules worth holding are about not moving a login from one person to
 * another. Attendance, leave and payslips all hang off the employee record a
 * login points at.
 */

let t: Tenants;
let strayUserId: string;
let freeEmployeeId: string;

beforeAll(async () => {
  t = await seedTenants();

  // An account with no employee record, the way `inviteWithRoles` leaves one.
  strayUserId = await withPlatform(async (db) => {
    const user = await db.user.create({
      data: { companyId: t.acme.companyId, email: "stray@acme.test", status: "active" },
      select: { id: true },
    });
    return user.id;
  });

  // A record with no account, the way HR leaves one before sending an invite.
  freeEmployeeId = await withPlatform(async (db) => {
    const employee = await db.employee.create({
      data: {
        companyId: t.acme.companyId,
        employeeCode: "ACME-FREE",
        firstName: "Unconnected",
        workEmail: "unconnected@acme.test",
        departmentId: t.acme.departmentId,
        designationId: t.acme.designationId,
        locationId: t.acme.locationId,
        employmentType: "full_time",
        status: "active",
        joinDate: new Date("2026-01-05"),
      },
      select: { id: true },
    });
    return employee.id;
  });
});

describe("the picker", () => {
  it("offers the account that has no employee record", async () => {
    const result = await call<{ id: string; email: string }[]>(
      accountOptions,
      "/api/v1/employees/account-options",
      { as: t.acme.hr },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.map((row) => row.id)).toContain(strayUserId);
  });

  it("does not offer accounts that already belong to somebody", async () => {
    const result = await call<{ id: string }[]>(
      accountOptions,
      "/api/v1/employees/account-options",
      { as: t.acme.hr },
    );

    expect(result.data.map((row) => row.id)).not.toContain(t.acme.employee.userId);
  });

  it("shows the other tenant nothing of ours", async () => {
    const result = await call<{ id: string }[]>(
      accountOptions,
      "/api/v1/employees/account-options",
      { as: t.globex.hr },
    );

    expect(result.data.map((row) => row.id)).not.toContain(strayUserId);
  });
});

describe("linking", () => {
  it("is refused to somebody who cannot manage users", async () => {
    const result = await call(linkAccount, `/api/v1/employees/${freeEmployeeId}/link-account`, {
      as: t.acme.employee,
      method: "POST",
      params: { id: freeEmployeeId },
      body: { userId: strayUserId },
    });

    expect(result.status).toBe(403);
  });

  it("will not reach across tenants", async () => {
    const result = await call(linkAccount, `/api/v1/employees/${freeEmployeeId}/link-account`, {
      as: t.globex.hr,
      method: "POST",
      params: { id: freeEmployeeId },
      body: { userId: strayUserId },
    });

    // Not theirs to see, so not found rather than forbidden.
    expect(result.status).toBe(404);
  });

  it("connects the account to the record", async () => {
    const result = await call<{ employeeId: string; userId: string }>(
      linkAccount,
      `/api/v1/employees/${freeEmployeeId}/link-account`,
      {
        as: t.acme.hr,
        method: "POST",
        params: { id: freeEmployeeId },
        body: { userId: strayUserId },
      },
    );

    expect(result.status, result.error?.message).toBe(200);

    const row = await withPlatform((db) =>
      db.employee.findFirstOrThrow({
        where: { id: freeEmployeeId },
        select: { userId: true },
      }),
    );
    expect(row.userId).toBe(strayUserId);
  });

  it("is in the audit trail, because it changes who a login speaks for", async () => {
    const row = await withPlatform((db) =>
      db.auditLog.findFirst({
        where: { companyId: t.acme.companyId, action: "user.linked_to_employee" },
        orderBy: { createdAt: "desc" },
        select: { actorUserId: true, entityId: true, after: true },
      }),
    );

    expect(row?.actorUserId).toBe(t.acme.hr.userId);
    expect(row?.entityId).toBe(strayUserId);
    expect(JSON.stringify(row?.after)).toContain(freeEmployeeId);
  });

  it("no longer offers that account", async () => {
    const result = await call<{ id: string }[]>(
      accountOptions,
      "/api/v1/employees/account-options",
      { as: t.acme.hr },
    );

    expect(result.data.map((row) => row.id)).not.toContain(strayUserId);
  });

  it("refuses to take an account away from the employee holding it", async () => {
    const other = await withPlatform(async (db) => {
      const employee = await db.employee.create({
        data: {
          companyId: t.acme.companyId,
          employeeCode: "ACME-FREE-2",
          firstName: "Also unconnected",
          departmentId: t.acme.departmentId,
          designationId: t.acme.designationId,
          locationId: t.acme.locationId,
          employmentType: "full_time",
          status: "active",
          joinDate: new Date("2026-01-05"),
        },
        select: { id: true },
      });
      return employee.id;
    });

    const result = await call(linkAccount, `/api/v1/employees/${other}/link-account`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: other },
      body: { userId: strayUserId },
    });

    expect(result.status).toBe(422);
    expect(result.error?.code).toBe("BUSINESS_RULE");
  });

  it("refuses to give a second account to somebody who already has one", async () => {
    const spare = await withPlatform(async (db) => {
      const user = await db.user.create({
        data: { companyId: t.acme.companyId, email: "spare@acme.test", status: "invited" },
        select: { id: true },
      });
      return user.id;
    });

    const result = await call(
      linkAccount,
      `/api/v1/employees/${t.acme.employee.employeeId}/link-account`,
      {
        as: t.acme.hr,
        method: "POST",
        params: { id: t.acme.employee.employeeId },
        body: { userId: spare },
      },
    );

    expect(result.status).toBe(422);
    expect(result.error?.code).toBe("BUSINESS_RULE");
  });
});

describe("inviting somebody directly", () => {
  it("offers the records that have no account", async () => {
    const result = await call<{ id: string }[]>(
      unlinkedOptions,
      "/api/v1/employees/unlinked-options",
      { as: t.acme.hr },
    );

    expect(result.status, result.error?.message).toBe(200);
    // `freeEmployeeId` was linked above; the second spare record was not.
    expect(result.data.map((row) => row.id)).not.toContain(freeEmployeeId);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("attaches the record as the invite goes out", async () => {
    const spare = await withPlatform(async (db) => {
      const employee = await db.employee.create({
        data: {
          companyId: t.acme.companyId,
          employeeCode: "ACME-INVITE-ATTACH",
          firstName: "Attached",
          departmentId: t.acme.departmentId,
          designationId: t.acme.designationId,
          locationId: t.acme.locationId,
          employmentType: "full_time",
          status: "active",
          joinDate: new Date("2026-02-02"),
        },
        select: { id: true },
      });
      return employee.id;
    });

    const roles = await withPlatform((db) =>
      db.role.findMany({ where: { companyId: t.acme.companyId }, select: { id: true }, take: 1 }),
    );

    const result = await call<{ userId: string }>(inviteUser, "/api/v1/users/invite", {
      as: t.acme.hr,
      method: "POST",
      body: {
        email: "attached@acme.test",
        roleIds: roles.map((role) => role.id),
        employeeId: spare,
      },
    });

    expect(result.status, result.error?.message).toBe(201);

    const row = await withPlatform((db) =>
      db.employee.findFirstOrThrow({ where: { id: spare }, select: { userId: true } }),
    );
    expect(row.userId).toBe(result.data.userId);
  });

  it("refuses a record that already has one", async () => {
    const roles = await withPlatform((db) =>
      db.role.findMany({ where: { companyId: t.acme.companyId }, select: { id: true }, take: 1 }),
    );

    const result = await call(inviteUser, "/api/v1/users/invite", {
      as: t.acme.hr,
      method: "POST",
      body: {
        email: "second-account@acme.test",
        roleIds: roles.map((role) => role.id),
        employeeId: t.acme.employee.employeeId,
      },
    });

    expect(result.status).toBe(422);
    expect(result.error?.code).toBe("BUSINESS_RULE");
  });
});

describe("creating the record for an account that has one already", () => {
  it("creates it and connects it in one step", async () => {
    const account = await withPlatform(async (db) => {
      const user = await db.user.create({
        data: { companyId: t.acme.companyId, email: "orphan@acme.test", status: "active" },
        select: { id: true },
      });
      return user.id;
    });

    const result = await call<{ id: string }>(createEmployee, "/api/v1/employees", {
      as: t.acme.hr,
      method: "POST",
      body: {
        firstName: "Orphan",
        lastName: "Account",
        workEmail: "orphan@acme.test",
        departmentId: t.acme.departmentId,
        designationId: t.acme.designationId,
        locationId: t.acme.locationId,
        employmentType: "full_time",
        joinDate: "2026-03-01",
        linkUserId: account,
      },
    });

    expect(result.status, result.error?.message).toBe(201);

    const row = await withPlatform((db) =>
      db.employee.findFirstOrThrow({ where: { id: result.data.id }, select: { userId: true } }),
    );
    expect(row.userId).toBe(account);
  });

  it("refuses an account that belongs to somebody, without leaving a record behind", async () => {
    const before = await withPlatform((db) =>
      db.employee.count({ where: { companyId: t.acme.companyId } }),
    );

    const result = await call(createEmployee, "/api/v1/employees", {
      as: t.acme.hr,
      method: "POST",
      body: {
        firstName: "Should not exist",
        departmentId: t.acme.departmentId,
        designationId: t.acme.designationId,
        locationId: t.acme.locationId,
        employmentType: "full_time",
        joinDate: "2026-03-01",
        linkUserId: t.acme.employee.userId,
      },
    });

    expect(result.status).toBe(422);

    // The account is checked before the record is written, so a refusal does
    // not leave an employee nobody asked for.
    const after = await withPlatform((db) =>
      db.employee.count({ where: { companyId: t.acme.companyId } }),
    );
    expect(after).toBe(before);
  });

  it("will not also send an invite to somebody who already has an account", async () => {
    const account = await withPlatform(async (db) => {
      const user = await db.user.create({
        data: { companyId: t.acme.companyId, email: "orphan2@acme.test", status: "active" },
        select: { id: true },
      });
      return user.id;
    });

    const result = await call(createEmployee, "/api/v1/employees", {
      as: t.acme.hr,
      method: "POST",
      body: {
        firstName: "Orphan",
        workEmail: "orphan2@acme.test",
        departmentId: t.acme.departmentId,
        designationId: t.acme.designationId,
        locationId: t.acme.locationId,
        employmentType: "full_time",
        joinDate: "2026-03-01",
        linkUserId: account,
        invite: true,
      },
    });

    // 400 rather than 422: the two fields contradict each other, which the
    // schema settles before any rule about the world is consulted.
    expect(result.status).toBe(400);
  });
});
