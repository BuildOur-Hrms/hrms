import { beforeAll, describe, expect, it } from "vitest";

import { GET as listRoles, POST as createRole } from "@/app/api/v1/roles/route";
import { DELETE as deleteRole, PATCH as patchRole } from "@/app/api/v1/roles/[id]/route";
import { PUT as setPermissions } from "@/app/api/v1/roles/[id]/permissions/route";
import { POST as assignRole } from "@/app/api/v1/users/[id]/roles/route";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * Roles a company defines for itself.
 *
 * The whole risk here is one sentence long: `roles.manage` belongs to
 * hr_admin, so if a role could hold a permission its author does not, an HR
 * administrator could write themselves a super-administrator role. Most of
 * what follows is about that.
 */

interface Role {
  id: string;
  name: string;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

let t: Tenants;
let customId: string;

beforeAll(async () => {
  t = await seedTenants();
});

describe("creating a role", () => {
  it("is refused to somebody without roles.manage", async () => {
    const result = await call(createRole, "/api/v1/roles", {
      as: t.acme.employee,
      method: "POST",
      body: { name: "sneaky", permissions: [] },
    });

    expect(result.status).toBe(403);
  });

  it("is allowed to HR, with permissions HR already holds", async () => {
    const result = await call<{ id: string; name: string }>(createRole, "/api/v1/roles", {
      as: t.acme.hr,
      method: "POST",
      body: {
        name: "recruiter",
        description: "Hiring, and nothing else",
        permissions: ["recruitment.view_all", "recruitment.manage"],
      },
    });

    expect(result.status, result.error?.message).toBe(201);
    customId = result.data.id;
  });

  it("will not grant a permission the author does not hold", async () => {
    /*
     * The escalation this whole guard exists for. `platform.manage` is the
     * one thing hr_admin lacks, so it stands in for every permission a
     * narrower role will lack once companies start defining their own.
     */
    const result = await call(createRole, "/api/v1/roles", {
      as: t.acme.hr,
      method: "POST",
      body: { name: "backdoor", permissions: ["platform.manage"] },
    });

    expect(result.status).toBe(403);
    expect(result.error?.message).toMatch(/cannot grant a permission you do not hold/i);
  });

  it("refuses a name already taken", async () => {
    const result = await call(createRole, "/api/v1/roles", {
      as: t.acme.hr,
      method: "POST",
      body: { name: "recruiter", permissions: [] },
    });

    expect(result.status).toBe(409);
  });

  it("refuses a name the rest of the system could not print", async () => {
    const result = await call(createRole, "/api/v1/roles", {
      as: t.acme.hr,
      method: "POST",
      body: { name: "Head of People!", permissions: [] },
    });

    expect(result.status).toBe(400);
  });
});

describe("the seeded four", () => {
  it("are marked as system roles", async () => {
    const result = await call<Role[]>(listRoles, "/api/v1/roles", { as: t.acme.hr });

    const system = result.data.filter((role) => role.isSystem).map((role) => role.name);
    expect(system.sort()).toEqual(["employee", "hr_admin", "manager", "super_admin"]);
  });

  it("cannot have their permissions changed", async () => {
    const roles = await call<Role[]>(listRoles, "/api/v1/roles", { as: t.acme.hr });
    const employee = roles.data.find((role) => role.name === "employee")!;

    const result = await call(setPermissions, `/api/v1/roles/${employee.id}/permissions`, {
      as: t.acme.hr,
      method: "PUT",
      params: { id: employee.id },
      body: { permissions: [] },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/system role/i);
  });

  it("cannot be deleted", async () => {
    const roles = await call<Role[]>(listRoles, "/api/v1/roles", { as: t.acme.hr });
    const manager = roles.data.find((role) => role.name === "manager")!;

    const result = await call(deleteRole, `/api/v1/roles/${manager.id}`, {
      as: t.acme.hr,
      method: "DELETE",
      params: { id: manager.id },
    });

    expect(result.status).toBe(422);
  });
});

describe("a custom role", () => {
  it("can have its permissions replaced wholesale", async () => {
    const result = await call(setPermissions, `/api/v1/roles/${customId}/permissions`, {
      as: t.acme.hr,
      method: "PUT",
      params: { id: customId },
      body: { permissions: ["recruitment.view_all"] },
    });

    expect(result.status, result.error?.message).toBe(200);

    const roles = await call<Role[]>(listRoles, "/api/v1/roles", { as: t.acme.hr });
    const role = roles.data.find((r) => r.id === customId)!;
    expect(role.permissions).toEqual(["recruitment.view_all"]);
  });

  it("still will not take a permission the author lacks", async () => {
    const result = await call(setPermissions, `/api/v1/roles/${customId}/permissions`, {
      as: t.acme.hr,
      method: "PUT",
      params: { id: customId },
      body: { permissions: ["recruitment.view_all", "platform.view_all"] },
    });

    expect(result.status).toBe(403);
  });

  it("takes a description", async () => {
    const result = await call<{ description: string | null }>(
      patchRole,
      `/api/v1/roles/${customId}`,
      {
        as: t.acme.hr,
        method: "PATCH",
        params: { id: customId },
        body: { description: "Hiring only" },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.description).toBe("Hiring only");
  });

  it("cannot be deleted while somebody holds it", async () => {
    const assigned = await call(assignRole, `/api/v1/users/${t.acme.employee.userId}/roles`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: t.acme.employee.userId },
      body: { roleId: customId },
    });
    expect(assigned.status, assigned.error?.message).toBeLessThan(300);

    const result = await call(deleteRole, `/api/v1/roles/${customId}`, {
      as: t.acme.hr,
      method: "DELETE",
      params: { id: customId },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/still held by/i);
  });

  it("stays inside its own company", async () => {
    const theirs = await call<Role[]>(listRoles, "/api/v1/roles", { as: t.globex.hr });

    expect(theirs.data.map((role) => role.id)).not.toContain(customId);
    expect(theirs.data.some((role) => role.name === "recruiter")).toBe(false);
  });
});
