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
 * Converges rather than rebuilds. Every write is an upsert on a natural key,
 * so re-running resets the passwords, the settings and the leave balance
 * without deleting anything. Deleting was the obvious design and the wrong
 * one: every foreign key to `companies` is RESTRICT on purpose, and the audit
 * trail is append-only by database trigger. Both are correct, and both are
 * exactly what a teardown has to fight. A fixture that converges never has to.
 */

export const E2E_SLUG = "e2e";
export const E2E_PASSWORD = "e2e-Password-1234";

export const E2E_USERS = {
  hr: `hr@${E2E_SLUG}.test`,
  manager: `manager@${E2E_SLUG}.test`,
  employee: `employee@${E2E_SLUG}.test`,
} as const;

const JOIN_DATE = new Date("2024-01-01T00:00:00.000Z");

/**
 * Find-or-create, for the models Prisma cannot upsert.
 *
 * Locations, departments, designations and employees carry *partial* unique
 * indexes — unique only among rows that are not soft-deleted, so a code can be
 * reused after the thing holding it is removed. `ON CONFLICT` cannot target a
 * partial index, so `upsert` fails on those four with a message about a
 * missing constraint that is genuinely there.
 */
async function findOrCreate<T extends { id: string }>(
  find: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<T> {
  return (await find()) ?? (await create());
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

  const company = await withPlatform((db) =>
    db.company.upsert({
      where: { slug: E2E_SLUG },
      create: {
        name: "E2E Test Co",
        slug: E2E_SLUG,
        timezone: "Asia/Kolkata",
        currency: "INR",
        status: "active",
      },
      update: { status: "active" },
      select: { id: true },
    }),
  );
  const companyId = company.id;

  // Back to the catalog defaults. A previous run may have switched the email
  // channel off to prove that it can, and a fixture that remembered would
  // make the next run's failure somebody else's afternoon.
  await withPlatform(async (db) => {
    for (const key of SETTING_KEYS.filter((k) => SETTINGS_CATALOG[k].scope === "company")) {
      const value = SETTINGS_CATALOG[key].default as never;
      await db.systemSetting.upsert({
        where: { companyId_key: { companyId, key } },
        create: { companyId, key, value },
        update: { value },
      });
    }
  });

  const org = await withPlatform(async (db) => {
    const location = await findOrCreate(
      () => db.location.findFirst({ where: { companyId, code: "HO" }, select: { id: true } }),
      () =>
        db.location.create({
          data: { companyId, name: "Head office", code: "HO" },
          select: { id: true },
        }),
    );
    const department = await findOrCreate(
      () => db.department.findFirst({ where: { companyId, code: "ENG" }, select: { id: true } }),
      () =>
        db.department.create({
          data: { companyId, name: "Engineering", code: "ENG" },
          select: { id: true },
        }),
    );
    const designation = await findOrCreate(
      () => db.designation.findFirst({ where: { companyId, code: "ENGR" }, select: { id: true } }),
      () =>
        db.designation.create({
          data: { companyId, title: "Engineer", code: "ENGR", level: 3 },
          select: { id: true },
        }),
    );
    const shift = await db.shift.upsert({
      where: { companyId_code: { companyId, code: "GEN" } },
      create: {
        companyId,
        name: "General",
        code: "GEN",
        startTime: new Date("1970-01-01T09:00:00.000Z"),
        endTime: new Date("1970-01-01T18:00:00.000Z"),
        graceMinutes: 10,
        halfDayThresholdMinutes: 240,
        isDefault: true,
      },
      update: { isDefault: true },
      select: { id: true },
    });
    const leaveType = await db.leaveType.upsert({
      where: { companyId_code: { companyId, code: "CL" } },
      create: { companyId, name: "Casual leave", code: "CL", isPaid: true },
      update: { deletedAt: null },
      select: { id: true },
    });
    await db.leavePolicy.upsert({
      where: { leaveTypeId: leaveType.id },
      create: {
        companyId,
        leaveTypeId: leaveType.id,
        accrualFrequency: "monthly",
        accrualAmount: 1,
      },
      update: {},
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
      const role = await db.role.upsert({
        where: { companyId_name: { companyId, name } },
        create: { companyId, name, description: ROLE_DESCRIPTIONS[name], isSystem: true },
        update: { description: ROLE_DESCRIPTIONS[name] },
        select: { id: true },
      });
      ids[name] = role.id;
      await db.rolePermission.createMany({
        data: ROLE_PERMISSIONS[name].map((code) => ({
          roleId: role.id,
          permissionId: idOf.get(code)!,
        })),
        skipDuplicates: true,
      });
    }
    return ids;
  });

  const passwordHash = await hashPassword(E2E_PASSWORD);

  /**
   * One account, reset to a known state.
   *
   * `failedLoginCount` and `lockedUntil` are cleared deliberately: the suite
   * signs in with a wrong password on purpose, and five of those across five
   * runs would lock the account on the sixth for a reason nobody would connect
   * to a test written weeks earlier.
   */
  async function account(
    role: SystemRole,
    email: string,
    firstName: string,
    managerId: string | null,
  ) {
    return withPlatform(async (db) => {
      const user = await db.user.upsert({
        where: { companyId_email: { companyId, email } },
        create: { companyId, email, passwordHash, status: "active" },
        update: { passwordHash, status: "active", failedLoginCount: 0, lockedUntil: null },
        select: { id: true },
      });

      const existing = await db.employee.findFirst({
        where: { companyId, employeeCode: `E2E-${role}` },
        select: { id: true },
      });
      const employee = existing
        ? await db.employee.update({
            where: { id: existing.id },
            data: { userId: user.id, managerId, status: "active" },
            select: { id: true },
          })
        : await db.employee.create({
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
              joinDate: JOIN_DATE,
            },
            select: { id: true },
          });

      await db.userRole.createMany({
        data: [{ userId: user.id, roleId: roleIds[role] }],
        skipDuplicates: true,
      });

      const assigned = await db.employeeShift.findFirst({
        where: { employeeId: employee.id, shiftId: org.shiftId },
        select: { id: true },
      });
      if (!assigned) {
        await db.employeeShift.create({
          data: {
            companyId,
            employeeId: employee.id,
            shiftId: org.shiftId,
            effectiveFrom: JOIN_DATE,
          },
        });
      }

      return employee.id;
    });
  }

  const managerEmployeeId = await account("manager", E2E_USERS.manager, "Morgan", null);
  await account("hr_admin", E2E_USERS.hr, "Harper", null);
  const employeeId = await account("employee", E2E_USERS.employee, "Eli", managerEmployeeId);

  // Topped back up, so the leave journey tests approval rather than rejection
  // however many times it has run before.
  const year = new Date().getUTCFullYear();
  await withPlatform((db) =>
    db.leaveBalance.upsert({
      where: {
        companyId_employeeId_leaveTypeId_year: {
          companyId,
          employeeId,
          leaveTypeId: org.leaveTypeId,
          year,
        },
      },
      create: { companyId, employeeId, leaveTypeId: org.leaveTypeId, year, opening: 40 },
      update: { opening: 40, accrued: 0, used: 0, carriedForward: 0, adjusted: 0 },
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
