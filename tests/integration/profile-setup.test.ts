import { beforeAll, describe, expect, it } from "vitest";

import { GET as getProfile, PATCH as updateProfile } from "@/app/api/v1/me/profile/route";
import { POST as completeProfile } from "@/app/api/v1/me/profile/complete/route";
import { withPlatform } from "@/lib/db";
import { SELF_EDITABLE_FIELDS } from "@/modules/employees/validators";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * What somebody may change about themselves after accepting an invite.
 *
 * The line under test is between what is true about a person and what a
 * company decided about them. Name, birthday and phone are theirs. Department,
 * designation, manager, join date, status and work email are not — an employee
 * who could set those could re-grade themselves.
 */

let t: Tenants;

beforeAll(async () => {
  t = await seedTenants();
});

describe("before setup", () => {
  it("has no stamp on the record", async () => {
    const result = await call<{ profileCompletedAt: string | null }>(
      getProfile,
      "/api/v1/me/profile",
      { as: t.acme.employee },
    );

    expect(result.status).toBe(200);
    expect(result.data.profileCompletedAt).toBeNull();
  });
});

describe("finishing setup", () => {
  it("saves the details and stamps the record in one request", async () => {
    const result = await call<{ firstName: string; profileCompletedAt: string | null }>(
      completeProfile,
      "/api/v1/me/profile/complete",
      {
        as: t.acme.employee,
        body: {
          firstName: "Elena",
          lastName: "Okafor",
          phone: "+91 90000 00000",
          personalEmail: "elena@personal.test",
          dateOfBirth: "1994-04-18",
          gender: "female",
          address: "12 Anywhere Street",
        },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.firstName).toBe("Elena");
    // The stamp and the values land together, so a browser dying between two
    // requests cannot leave somebody marked finished with nothing saved.
    expect(result.data.profileCompletedAt).not.toBeNull();
  });

  it("is recorded in the audit trail like any other change to a record", async () => {
    const row = await withPlatform((db) =>
      db.auditLog.findFirst({
        where: { companyId: t.acme.companyId, action: "employee.updated" },
        orderBy: { createdAt: "desc" },
        select: { actorUserId: true, after: true },
      }),
    );

    expect(row?.actorUserId).toBe(t.acme.employee.userId);
    expect(JSON.stringify(row?.after)).toMatch(/firstName|changedFields/);
  });
});

describe("what is theirs to change", () => {
  it("takes every field on the allowlist", async () => {
    const result = await call<{ phone: string | null; gender: string | null }>(
      updateProfile,
      "/api/v1/me/profile",
      {
        as: t.acme.employee,
        method: "PATCH",
        body: { phone: "+91 91111 11111", gender: "undisclosed" },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.phone).toBe("+91 91111 11111");
    expect(result.data.gender).toBe("undisclosed");
  });

  it("lets somebody correct their own name", async () => {
    const result = await call<{ lastName: string | null }>(updateProfile, "/api/v1/me/profile", {
      as: t.acme.employee,
      method: "PATCH",
      body: { lastName: "Okonkwo" },
    });

    expect(result.status).toBe(200);
    expect(result.data.lastName).toBe("Okonkwo");
  });
});

describe("what is not", () => {
  const forbidden: [string, unknown][] = [
    ["departmentId", "00000000-0000-0000-0000-000000000001"],
    ["designationId", "00000000-0000-0000-0000-000000000001"],
    ["locationId", "00000000-0000-0000-0000-000000000001"],
    ["managerId", "00000000-0000-0000-0000-000000000001"],
    ["employmentType", "contract"],
    ["status", "active"],
    ["joinDate", "2020-01-01"],
    ["employeeCode", "CHOSEN-BY-ME"],
    ["workEmail", "somebody.else@acme.test"],
    ["profileCompletedAt", null],
  ];

  it.each(forbidden)("ignores %s rather than honouring it", async (field, value) => {
    const before = await withPlatform((db) =>
      db.employee.findFirstOrThrow({
        where: { id: t.acme.employee.employeeId },
        select: {
          departmentId: true,
          designationId: true,
          locationId: true,
          managerId: true,
          employmentType: true,
          status: true,
          joinDate: true,
          employeeCode: true,
          workEmail: true,
        },
      }),
    );

    // The field is absent from the schema, so it is stripped on the way in
    // rather than validated and refused — the request succeeds and changes
    // nothing, which is what an allowlist does.
    const result = await call(updateProfile, "/api/v1/me/profile", {
      as: t.acme.employee,
      method: "PATCH",
      body: { [field]: value, phone: "+91 92222 22222" },
    });
    expect(result.status).toBe(200);

    const after = await withPlatform((db) =>
      db.employee.findFirstOrThrow({
        where: { id: t.acme.employee.employeeId },
        select: {
          departmentId: true,
          designationId: true,
          locationId: true,
          managerId: true,
          employmentType: true,
          status: true,
          joinDate: true,
          employeeCode: true,
          workEmail: true,
        },
      }),
    );

    expect(after).toEqual(before);
  });

  it("keeps the allowlist to personal details only", () => {
    // A guard on the list itself: adding a job field here would quietly open
    // every one of the cases above.
    expect([...SELF_EDITABLE_FIELDS].sort()).toEqual([
      "address",
      "dateOfBirth",
      "firstName",
      "gender",
      "lastName",
      "personalEmail",
      "phone",
    ]);
  });
});

describe("skipping", () => {
  it("stamps the record without changing anything", async () => {
    const before = await withPlatform((db) =>
      db.employee.findFirstOrThrow({
        where: { id: t.acme.manager.employeeId },
        select: { firstName: true, phone: true },
      }),
    );

    const result = await call<{ profileCompletedAt: string | null }>(
      completeProfile,
      "/api/v1/me/profile/complete",
      { as: t.acme.manager, body: {} },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.profileCompletedAt).not.toBeNull();

    const after = await withPlatform((db) =>
      db.employee.findFirstOrThrow({
        where: { id: t.acme.manager.employeeId },
        select: { firstName: true, phone: true },
      }),
    );
    expect(after).toEqual(before);
  });
});

describe("an account with no employee record", () => {
  it("is told so rather than crashing", async () => {
    await withPlatform((db) =>
      db.employee.updateMany({
        where: { userId: t.globex.superAdmin.userId },
        data: { userId: null },
      }),
    );

    const result = await call(completeProfile, "/api/v1/me/profile/complete", {
      as: t.globex.superAdmin,
      body: { firstName: "Nobody" },
    });

    expect(result.status).toBe(422);
    expect(result.error?.code).toBe("BUSINESS_RULE");
  });
});
