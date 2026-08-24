import { beforeAll, describe, expect, it } from "vitest";

import { GET as getProfile, POST as setUpProfile } from "@/app/api/v1/me/profile/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Persona, type Tenants } from "./harness";

/**
 * An administrator setting up their own employee record.
 *
 * The gap: the seed gives the HR admin a record and the platform owner none,
 * so that account opened its own profile and was told to ask HR to connect it
 * — advice addressed to the person reading it.
 */

let t: Tenants;
/** An account with a login and no employee record, as the seed leaves one. */
let unlinked: Persona;

beforeAll(async () => {
  t = await seedTenants();

  // Detach the super admin's employee record, which is the shape the real
  // platform-owner account arrives in.
  const employee = await withPlatform((db) =>
    db.employee.findFirstOrThrow({
      where: { userId: t.acme.superAdmin.userId },
      select: { id: true },
    }),
  );
  await withPlatform((db) =>
    db.employee.update({ where: { id: employee.id }, data: { userId: null } }),
  );

  unlinked = t.acme.superAdmin;
});

function setUp(as: Persona, over: Record<string, unknown> = {}) {
  return call<{ id: string; employeeCode: string; status: string }>(
    setUpProfile,
    "/api/v1/me/profile",
    {
      as,
      body: {
        firstName: "Ada",
        lastName: "Owner",
        departmentId: t.acme.departmentId,
        designationId: t.acme.designationId,
        locationId: t.acme.locationId,
        employmentType: "full_time",
        joinDate: "2024-01-01",
        ...over,
      },
    },
  );
}

describe("before setting up", () => {
  it("has no profile to show", async () => {
    const result = await call(getProfile, "/api/v1/me/profile", { as: unlinked });

    expect(result.status).toBe(422);
    expect(result.error?.code).toBe("BUSINESS_RULE");
  });
});

describe("setting up", () => {
  it("creates the record and links it to the account", async () => {
    const result = await setUp(unlinked);

    expect(result.status, result.error?.message).toBe(201);
    expect(result.data.employeeCode).toMatch(/^EMP\d+$/);
    // Not `onboarding`: somebody setting themselves up is already at work.
    expect(result.data.status).toBe("active");

    const linked = await withPlatform((db) =>
      db.employee.findFirstOrThrow({
        where: { id: result.data.id },
        select: { userId: true, companyId: true },
      }),
    );
    expect(linked.userId).toBe(unlinked.userId);
    expect(linked.companyId).toBe(t.acme.companyId);
  });

  it("makes the profile readable straight afterwards", async () => {
    const result = await call<{ firstName: string }>(getProfile, "/api/v1/me/profile", {
      as: unlinked,
    });

    expect(result.status).toBe(200);
    expect(result.data.firstName).toBe("Ada");
  });

  it("is recorded in the audit trail as a self-setup", async () => {
    const row = await withPlatform((db) =>
      db.auditLog.findFirst({
        where: { companyId: t.acme.companyId, action: "employee.created" },
        orderBy: { createdAt: "desc" },
        select: { actorUserId: true, after: true },
      }),
    );

    expect(row?.actorUserId).toBe(unlinked.userId);
    // "HR added a person" and "an administrator set themselves up" read very
    // differently a year later.
    expect(JSON.stringify(row?.after)).toContain("selfSetUp");
  });

  it("refuses a second one for the same account", async () => {
    const result = await setUp(unlinked);

    expect(result.status).toBe(409);
    expect(result.error?.message).toMatch(/already has an employee record/i);
  });
});

describe("what it will not accept", () => {
  it("refuses somebody who cannot create employees at all", async () => {
    const result = await setUp(t.acme.employee);
    expect(result.status).toBe(403);
  });

  it("refuses a department from another company", async () => {
    // A fresh unlinked account, so the refusal is about the department rather
    // than about already having a record.
    const employee = await withPlatform((db) =>
      db.employee.findFirstOrThrow({
        where: { userId: t.acme.hr.userId },
        select: { id: true },
      }),
    );
    await withPlatform((db) =>
      db.employee.update({ where: { id: employee.id }, data: { userId: null } }),
    );

    const result = await setUp(t.acme.hr, { departmentId: t.globex.departmentId });
    expect(result.status).toBe(404);
  });

  it("cannot grade itself: manager, status and code are not in the schema", async () => {
    const result = await setUp(t.acme.hr, {
      managerId: null,
      status: "exited",
      employeeCode: "CHOSEN-BY-ME",
    });

    expect(result.status, result.error?.message).toBe(201);
    // The extra fields were stripped, not honoured.
    expect(result.data.status).toBe("active");
    expect(result.data.employeeCode).not.toBe("CHOSEN-BY-ME");
  });
});
