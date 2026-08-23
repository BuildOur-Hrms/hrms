import "dotenv/config";

import { withPlatform } from "../src/lib/db.ts";
import { env } from "../src/lib/env.ts";
import {
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  type SystemRole,
} from "../src/lib/permissions.ts";
import { hashPassword } from "../src/modules/auth/password.ts";
import { SETTINGS_CATALOG, SETTING_KEYS } from "../src/modules/settings/catalog.ts";

/**
 * The fixture the browser tests sign in to.
 *
 *   npm run db:seed-e2e
 *
 * Separate from the main seed for one reason: this one writes passwords. The
 * main seed deliberately never does — a seeded credential is a credential that
 * eventually reaches production — so the accounts that need one live here,
 * behind a refusal to run outside development and test.
 *
 * Re-running drops and rebuilds the company, so a failed run never leaves a
 * half-built fixture for the next one to trip over.
 */

export const E2E_SLUG = "e2e";
export const E2E_PASSWORD = "e2e-Password-1234";

export const E2E_USERS = {
  hr: `hr@${E2E_SLUG}.test`,
  manager: `manager@${E2E_SLUG}.test`,
  employee: `employee@${E2E_SLUG}.test`,
} as const;

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function main() {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed test credentials into production");
  }

  console.log("\nSeeding the end-to-end fixture\n");

  await withPlatform((db) =>
    db.permission.createMany({
      data: PERMISSIONS.map((p) => ({ code: p.code, module: p.module, action: p.action })),
      skipDuplicates: true,
    }),
  );

  // Rebuild from scratch. `deleteMany` cascades through the tenant's rows via
  // the schema's onDelete rules, except audit_logs, which is append-only by
  // trigger and restricts the company delete — so it goes first, explicitly.
  const previous = await withPlatform((db) =>
    db.company.findFirst({ where: { slug: E2E_SLUG }, select: { id: true } }),
  );
  if (previous) {
    await withPlatform(async (db) => {
      await db.$executeRawUnsafe(`DELETE FROM audit_logs WHERE company_id = '${previous.id}'`);
      await db.company.delete({ where: { id: previous.id } });
    });
    console.log("  removed the previous fixture");
  }

  const company = await withPlatform((db) =>
    db.company.create({
      data: {
        name: "E2E Test Co",
        slug: E2E_SLUG,
        timezone: "Asia/Kolkata",
        currency: "INR",
        status: "active",
      },
      select: { id: true },
    }),
  );
  const companyId = company.id;

  await withPlatform(async (db) => {
    const keys = SETTING_KEYS.filter((k) => SETTINGS_CATALOG[k].scope === "company");
    await db.systemSetting.createMany({
      data: keys.map((key) => ({
        companyId,
        key,
        value: SETTINGS_CATALOG[key].default as never,
      })),
    });
  });

  const org = await withPlatform(async (db) => {
    const location = await db.location.create({
      data: { companyId, name: "Head office", code: "HO" },
      select: { id: true },
    });
    const department = await db.department.create({
      data: { companyId, name: "Engineering", code: "ENG" },
      select: { id: true },
    });
    const designation = await db.designation.create({
      data: { companyId, title: "Engineer", code: "ENGR", level: 3 },
      select: { id: true },
    });
    const shift = await db.shift.create({
      data: {
        companyId,
        name: "General",
        code: "GEN",
        startTime: new Date("1970-01-01T09:00:00.000Z"),
        endTime: new Date("1970-01-01T18:00:00.000Z"),
        graceMinutes: 10,
        halfDayThresholdMinutes: 240,
        isDefault: true,
      },
      select: { id: true },
    });
    const leaveType = await db.leaveType.create({
      data: { companyId, name: "Casual leave", code: "CL", isPaid: true },
      select: { id: true },
    });
    await db.leavePolicy.create({
      data: { companyId, leaveTypeId: leaveType.id, accrualFrequency: "monthly", accrualAmount: 1 },
    });
    return {
      locationId: location.id,
      departmentId: department.id,
      designationId: designation.id,
      shiftId: shift.id,
      leaveTypeId: leaveType.id,
    };
  });

  const roleIds = await withPlatform(async (db) => {
    const permissions = await db.permission.findMany({ select: { id: true, code: true } });
    const idOf = new Map(permissions.map((p) => [p.code, p.id]));
    const ids = {} as Record<SystemRole, string>;

    for (const name of SYSTEM_ROLES) {
      const role = await db.role.create({
        data: { companyId, name, description: ROLE_DESCRIPTIONS[name], isSystem: true },
        select: { id: true },
      });
      ids[name] = role.id;
      await db.rolePermission.createMany({
        data: ROLE_PERMISSIONS[name].map((code) => ({
          roleId: role.id,
          permissionId: idOf.get(code)!,
        })),
      });
    }
    return ids;
  });

  const passwordHash = await hashPassword(E2E_PASSWORD);

  async function account(
    role: SystemRole,
    email: string,
    firstName: string,
    managerId: string | null,
  ) {
    return withPlatform(async (db) => {
      const user = await db.user.create({
        data: { companyId, email, passwordHash, status: "active" },
        select: { id: true },
      });
      const employee = await db.employee.create({
        data: {
          companyId,
          userId: user.id,
          employeeCode: `E2E-${role}`,
          firstName,
          lastName: "Tester",
          departmentId: org.departmentId,
          designationId: org.designationId,
          locationId: org.locationId,
          managerId,
          employmentType: "full_time",
          status: "active",
          joinDate: dateOnly("2024-01-01"),
        },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: roleIds[role] } });
      await db.employeeShift.create({
        data: {
          companyId,
          employeeId: employee.id,
          shiftId: org.shiftId,
          effectiveFrom: dateOnly("2024-01-01"),
        },
      });
      return employee.id;
    });
  }

  const managerEmployeeId = await account("manager", E2E_USERS.manager, "Morgan", null);
  await account("hr_admin", E2E_USERS.hr, "Harper", null);
  const employeeId = await account("employee", E2E_USERS.employee, "Eli", managerEmployeeId);

  // A balance to spend, so the leave flow tests approval rather than rejection.
  await withPlatform((db) =>
    db.leaveBalance.create({
      data: {
        companyId,
        employeeId,
        leaveTypeId: org.leaveTypeId,
        year: new Date().getUTCFullYear(),
        opening: 12,
      },
    }),
  );

  console.log(`  company: ${E2E_SLUG}`);
  for (const [role, email] of Object.entries(E2E_USERS)) {
    console.log(`  ${role.padEnd(9)} ${email}`);
  }
  console.log(`\n  password: ${E2E_PASSWORD}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
