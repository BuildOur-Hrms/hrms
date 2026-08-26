import "dotenv/config";

import { withPlatform } from "../src/lib/db.ts";
import { env } from "../src/lib/env.ts";
import {
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from "../src/lib/permissions.ts";
import { SETTINGS_CATALOG, SETTING_KEYS } from "../src/modules/settings/catalog.ts";
import { issueToken, buildInviteUrl } from "../src/modules/auth/tokens.ts";

/**
 * Seed (docs/04-database.md §5).
 *
 * Idempotent: safe to re-run against an existing database. It upserts the
 * permission catalog, the pilot company, the four system roles and their
 * grants, the settings defaults, and two invited administrator accounts.
 *
 * No password is ever seeded. Both accounts land in `invited` state and the
 * script prints their invite links — a seeded credential is a credential that
 * reaches production.
 *
 * `SEED_DEMO=true` additionally creates a small sample organisation.
 *
 * ── On the shape of this file ────────────────────────────────────────────
 * Written as several short transactions of bulk statements rather than one
 * long transaction of single-row upserts. The row count is small (~400) but
 * the round-trip count is what matters: against a pooled database in another
 * region, 400 sequential round trips is well over two minutes and blows the
 * interactive-transaction timeout. The same work as ~25 statements finishes in
 * seconds. Each step is independently idempotent, so a failure part-way leaves
 * a re-runnable database rather than a half-seeded one.
 */

const DEMO_DEPARTMENTS = [
  { name: "Engineering", code: "ENG" },
  { name: "Human Resources", code: "HR" },
  { name: "Sales", code: "SALES" },
  { name: "Finance", code: "FIN" },
];

const DEMO_DESIGNATIONS = [
  { title: "Intern", code: "INTERN", level: 1 },
  { title: "Associate", code: "ASSOC", level: 2 },
  { title: "Senior Associate", code: "SR_ASSOC", level: 3 },
  { title: "Team Lead", code: "LEAD", level: 4 },
  { title: "Manager", code: "MGR", level: 5 },
  { title: "Director", code: "DIR", level: 6 },
];

const log = (message: string) => console.log(`  ${message}`);
const step = { timeoutMs: 30_000 };

async function main() {
  console.log("\nSeeding HRMS\n");

  const inviteLinks: { label: string; email: string; url: string }[] = [];

  // ── 1. permission catalog (global, not tenant-scoped)
  await withPlatform(async (db) => {
    await db.permission.createMany({
      data: PERMISSIONS.map((p) => ({ code: p.code, module: p.module, action: p.action })),
      skipDuplicates: true,
    });
  }, step);
  log(`permissions: ${PERMISSIONS.length}`);

  // ── 2. global settings defaults
  const globalKeys = SETTING_KEYS.filter((k) => SETTINGS_CATALOG[k].scope === "global");
  await withPlatform(async (db) => {
    const existing = await db.systemSetting.findMany({
      where: { companyId: null },
      select: { key: true },
    });
    const have = new Set(existing.map((r) => r.key));
    const missing = globalKeys.filter((k) => !have.has(k));

    if (missing.length > 0) {
      await db.systemSetting.createMany({
        data: missing.map((key) => ({
          companyId: null,
          key,
          value: SETTINGS_CATALOG[key].default as never,
        })),
      });
    }
  }, step);
  log(`global settings: ${globalKeys.length}`);

  // ── 3. pilot company
  const company = await withPlatform(
    (db) =>
      db.company.upsert({
        where: { slug: env.SEED_COMPANY_SLUG },
        create: {
          name: env.SEED_COMPANY_NAME,
          slug: env.SEED_COMPANY_SLUG,
          timezone: "Asia/Kolkata",
          currency: "INR",
          status: "active",
        },
        update: { name: env.SEED_COMPANY_NAME },
        select: { id: true, name: true, slug: true },
      }),
    step,
  );
  log(`company: ${company.name} (${company.slug})`);

  // ── 4. company settings defaults
  const companyKeys = SETTING_KEYS.filter((k) => SETTINGS_CATALOG[k].scope === "company");
  await withPlatform(async (db) => {
    const existing = await db.systemSetting.findMany({
      where: { companyId: company.id },
      select: { key: true },
    });
    const have = new Set(existing.map((r) => r.key));
    const missing = companyKeys.filter((k) => !have.has(k));

    if (missing.length > 0) {
      await db.systemSetting.createMany({
        data: missing.map((key) => ({
          companyId: company.id,
          key,
          value: SETTINGS_CATALOG[key].default as never,
        })),
      });
    }
  }, step);
  log(`company settings: ${companyKeys.length}`);

  // ── 5. system roles and their grants
  const permissionIds = await withPlatform(
    async (db) =>
      new Map(
        (await db.permission.findMany({ select: { id: true, code: true } })).map((p) => [
          p.code,
          p.id,
        ]),
      ),
    step,
  );

  for (const roleName of SYSTEM_ROLES) {
    const wanted = ROLE_PERMISSIONS[roleName];

    await withPlatform(async (db) => {
      const role = await db.role.upsert({
        where: { companyId_name: { companyId: company.id, name: roleName } },
        create: {
          companyId: company.id,
          name: roleName,
          description: ROLE_DESCRIPTIONS[roleName],
          isSystem: true,
        },
        update: { description: ROLE_DESCRIPTIONS[roleName], isSystem: true },
        select: { id: true },
      });

      // Replace the grant set rather than adding to it, so removing a
      // permission from the matrix actually revokes it on the next seed.
      await db.rolePermission.deleteMany({
        where: { roleId: role.id, permission: { code: { notIn: [...wanted] } } },
      });

      const data = wanted.map((code) => {
        const permissionId = permissionIds.get(code);
        if (!permissionId) throw new Error(`Permission missing from catalog: ${code}`);
        return { roleId: role.id, permissionId };
      });

      await db.rolePermission.createMany({ data, skipDuplicates: true });
    }, step);

    log(`role ${roleName}: ${wanted.length} permissions`);
  }

  // ── 6. baseline org so an employee can be created on day one
  const org = await withPlatform(async (db) => {
    const location = await db.location.upsert({
      where: { companyId_code: { companyId: company.id, code: "HQ" } },
      create: { companyId: company.id, name: "Head Office", code: "HQ" },
      update: {},
      select: { id: true },
    });
    const department = await db.department.upsert({
      where: { companyId_code: { companyId: company.id, code: "ADMIN" } },
      create: { companyId: company.id, name: "Administration", code: "ADMIN" },
      update: {},
      select: { id: true },
    });
    const designation = await db.designation.upsert({
      where: { companyId_code: { companyId: company.id, code: "ADMIN" } },
      create: { companyId: company.id, title: "Administrator", code: "ADMIN", level: 9 },
      update: {},
      select: { id: true },
    });
    // A default shift so attendance has rules to evaluate against from day
    // one, and so a new employee is never left with no shift at all.
    // 9-to-6 with an hour unpaid break, half-day under four worked hours.
    const shift = await db.shift.upsert({
      where: { companyId_code: { companyId: company.id, code: "GEN" } },
      create: {
        companyId: company.id,
        name: "General",
        code: "GEN",
        startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 18, 0, 0)),
        graceMinutes: 10,
        halfDayThresholdMinutes: 240,
        breakMinutes: 60,
        weekOffDays: [0, 6],
        isDefault: true,
      },
      update: {},
      select: { id: true },
    });

    /*
     * Leave types, because a company with none is a company where the apply
     * form has nothing in it.
     *
     * Three, and deliberately not more: casual and sick, which accrue, and
     * unpaid, which does not and has no balance by design. Anything beyond
     * that is a policy decision belonging to the company rather than to a
     * seed, and HR can add types under HR → Leave.
     */
    const leaveTypes: { code: string; name: string; isPaid: boolean; accrual: number }[] = [
      { code: "CL", name: "Casual leave", isPaid: true, accrual: 1 },
      { code: "SL", name: "Sick leave", isPaid: true, accrual: 0.5 },
      { code: "LWP", name: "Leave without pay", isPaid: false, accrual: 0 },
    ];

    for (const type of leaveTypes) {
      const existing = await db.leaveType.findFirst({
        where: { companyId: company.id, code: type.code },
        select: { id: true },
      });
      if (existing) continue;

      const created = await db.leaveType.create({
        data: {
          companyId: company.id,
          code: type.code,
          name: type.name,
          isPaid: type.isPaid,
        },
        select: { id: true },
      });

      await db.leavePolicy.create({
        data: {
          companyId: company.id,
          leaveTypeId: created.id,
          accrualFrequency: type.accrual > 0 ? "monthly" : "none",
          accrualAmount: type.accrual,
        },
      });
    }

    return { location, department, designation, shift };
  }, step);
  log("org: Head Office / Administration / Administrator / General shift");
  log("leave: Casual leave / Sick leave / Leave without pay");

  // ── 7. administrator accounts, invited (never seeded with a password)
  const roleIds = await withPlatform(
    async (db) =>
      new Map(
        (
          await db.role.findMany({
            where: { companyId: company.id },
            select: { id: true, name: true },
          })
        ).map((r) => [r.name, r.id]),
      ),
    step,
  );

  async function inviteAdmin(email: string, roleName: "super_admin" | "hr_admin") {
    const normalised = email.toLowerCase();

    return withPlatform(async (db) => {
      const user = await db.user.upsert({
        where: { companyId_email: { companyId: company.id, email: normalised } },
        create: { companyId: company.id, email: normalised, status: "invited" },
        update: {},
        select: { id: true, passwordHash: true },
      });

      const roleId = roleIds.get(roleName);
      if (!roleId) throw new Error(`Role missing: ${roleName}`);
      await db.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        create: { userId: user.id, roleId },
        update: {},
      });

      // Only issue a fresh invite if the account has never been claimed.
      // Re-seeding must not hand out a new link to a live account.
      if (user.passwordHash === null) {
        await db.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        const token = issueToken("invite");
        await db.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: token.hash,
            kind: "invite",
            expiresAt: token.expiresAt,
          },
        });
        inviteLinks.push({
          label: roleName,
          email: normalised,
          url: buildInviteUrl(env.APP_URL, token.raw),
        });
      } else {
        log(`${roleName} ${normalised} already active — invite not reissued`);
      }

      return user.id;
    }, step);
  }

  await inviteAdmin(env.SEED_ADMIN_EMAIL, "super_admin");
  const hrAdminId = await inviteAdmin(env.SEED_HR_EMAIL, "hr_admin");

  // Give the HR admin an employee record so self-service works for them.
  await withPlatform(
    (db) =>
      db.employee.upsert({
        where: { companyId_employeeCode: { companyId: company.id, employeeCode: "EMP0001" } },
        create: {
          companyId: company.id,
          userId: hrAdminId,
          employeeCode: "EMP0001",
          firstName: "HR",
          lastName: "Admin",
          workEmail: env.SEED_HR_EMAIL.toLowerCase(),
          departmentId: org.department.id,
          designationId: org.designation.id,
          locationId: org.location.id,
          employmentType: "full_time",
          status: "active",
          joinDate: new Date("2024-01-01T00:00:00.000Z"),
        },
        update: {},
      }),
    step,
  );
  log(`users: ${env.SEED_ADMIN_EMAIL} (super_admin), ${env.SEED_HR_EMAIL} (hr_admin)`);

  // ── 8. demo organisation
  if (env.SEED_DEMO) {
    await withPlatform(async (db) => {
      const existingDepartments = await db.department.findMany({
        where: { companyId: company.id },
        select: { code: true },
      });
      const haveDepartments = new Set(existingDepartments.map((d) => d.code));
      const newDepartments = DEMO_DEPARTMENTS.filter((d) => !haveDepartments.has(d.code));
      if (newDepartments.length > 0) {
        await db.department.createMany({
          data: newDepartments.map((d) => ({ companyId: company.id, ...d })),
        });
      }

      const existingDesignations = await db.designation.findMany({
        where: { companyId: company.id },
        select: { code: true },
      });
      const haveDesignations = new Set(existingDesignations.map((d) => d.code));
      const newDesignations = DEMO_DESIGNATIONS.filter((d) => !haveDesignations.has(d.code));
      if (newDesignations.length > 0) {
        await db.designation.createMany({
          data: newDesignations.map((d) => ({ companyId: company.id, ...d })),
        });
      }
    }, step);
    log(`demo: ${DEMO_DEPARTMENTS.length} departments, ${DEMO_DESIGNATIONS.length} designations`);
  }

  if (inviteLinks.length > 0) {
    console.log("\nInvite links (valid 7 days, single use):\n");
    for (const link of inviteLinks) {
      console.log(`  ${link.label.padEnd(12)} ${link.email}`);
      console.log(`  ${" ".repeat(12)} ${link.url}\n`);
    }
  }

  console.log("Seed complete.\n");
}

main()
  .catch((error: unknown) => {
    console.error("\nSeed failed:", error);
    process.exit(1);
  })
  .then(() => process.exit(0));
