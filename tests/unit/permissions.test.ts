import { describe, expect, it } from "vitest";

import {
  PERMISSIONS,
  PERMISSION_CODES,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  can,
  canAll,
  canAny,
  isPermissionCode,
  requirePermission,
  resolveScope,
  type PermissionCode,
} from "@/lib/permissions";

/**
 * The permission catalog is the authorization model. These assertions encode
 * the role matrix from docs/00-overview-and-roles.md §6.4, so an accidental
 * grant — an employee who can suddenly export payroll — fails CI rather than
 * shipping.
 */

const holder = (codes: PermissionCode[]) => ({ permissions: new Set(codes) });

describe("permission catalog", () => {
  it("has a unique code for every entry", () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
  });

  it("derives every code as module.action", () => {
    for (const permission of PERMISSIONS) {
      expect(permission.code).toBe(`${permission.module}.${permission.action}`);
    }
  });

  it("recognises only catalog codes", () => {
    expect(isPermissionCode("employee.view_all")).toBe(true);
    expect(isPermissionCode("employee.destroy")).toBe(false);
    expect(isPermissionCode("payroll.view_team")).toBe(false);
  });
});

describe("role matrix", () => {
  it("grants super_admin everything", () => {
    expect(ROLE_PERMISSIONS.super_admin).toHaveLength(PERMISSION_CODES.length);
  });

  it("gives every role only codes that exist", () => {
    for (const role of SYSTEM_ROLES) {
      for (const code of ROLE_PERMISSIONS[role]) {
        expect(PERMISSION_CODES).toContain(code);
      }
    }
  });

  it("keeps an employee to their own data", () => {
    const employee = ROLE_PERMISSIONS.employee;
    expect(employee).not.toContain("employee.view_all");
    expect(employee).not.toContain("employee.view_team");
    expect(employee).not.toContain("payroll.view_all");
    expect(employee).not.toContain("audit.view_all");
    expect(employee).toContain("employee.view_own");
    expect(employee).toContain("leave.create");
  });

  it("never lets a manager approve their own bracket of company-wide data", () => {
    const manager = ROLE_PERMISSIONS.manager;
    expect(manager).toContain("leave.approve");
    expect(manager).toContain("employee.view_team");
    expect(manager).not.toContain("employee.view_all");
    expect(manager).not.toContain("employee.edit");
    expect(manager).not.toContain("settings.manage");
  });

  it("keeps salary and bank data away from managers", () => {
    // The role model is explicit: managers see team *work* data only.
    for (const code of ROLE_PERMISSIONS.manager) {
      expect(code.startsWith("payroll.")).toBe(code === "payroll.view_own");
    }
  });

  it("gives hr_admin company administration but not platform settings", () => {
    const hr = ROLE_PERMISSIONS.hr_admin;
    expect(hr).toContain("employee.view_all");
    expect(hr).toContain("payroll.approve");
    expect(hr).toContain("audit.view_all");
    expect(hr).toContain("settings.manage");
  });

  it("gives every role the self-service baseline", () => {
    for (const role of SYSTEM_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toContain("employee.view_own");
      expect(ROLE_PERMISSIONS[role]).toContain("leave.view_own");
    }
  });

  it("never implies other actions from manage", () => {
    // `manage` is module configuration and grants nothing else on its own.
    const onlyManage = holder(["leave.manage"]);
    expect(can(onlyManage, "leave.approve")).toBe(false);
    expect(can(onlyManage, "leave.view_all")).toBe(false);
  });
});

describe("evaluation", () => {
  it("answers can / canAny / canAll", () => {
    const subject = holder(["leave.approve", "employee.view_team"]);
    expect(can(subject, "leave.approve")).toBe(true);
    expect(can(subject, "leave.view_all")).toBe(false);
    expect(canAny(subject, "leave.view_all", "leave.approve")).toBe(true);
    expect(canAll(subject, "leave.approve", "employee.view_team")).toBe(true);
    expect(canAll(subject, "leave.approve", "leave.view_all")).toBe(false);
  });

  it("works with an array as well as a Set", () => {
    expect(can({ permissions: ["employee.view_own"] }, "employee.view_own")).toBe(true);
  });

  it("throws 403 from requirePermission", () => {
    expect(() => requirePermission(holder([]), "employee.view_all")).toThrowError(
      /Missing permission/,
    );
    expect(() =>
      requirePermission(holder(["employee.view_all"]), "employee.view_all"),
    ).not.toThrow();
  });
});

describe("scope resolution", () => {
  it("prefers the widest tier the caller holds", () => {
    expect(resolveScope(holder(["employee.view_all", "employee.view_own"]), "employee")).toBe(
      "all",
    );
    expect(resolveScope(holder(["employee.view_team", "employee.view_own"]), "employee")).toBe(
      "team",
    );
    expect(resolveScope(holder(["employee.view_own"]), "employee")).toBe("own");
    expect(resolveScope(holder([]), "employee")).toBe("none");
  });

  it("resolves per module, not globally", () => {
    const subject = holder(["employee.view_all", "leave.view_own"]);
    expect(resolveScope(subject, "employee")).toBe("all");
    expect(resolveScope(subject, "leave")).toBe("own");
  });
});
