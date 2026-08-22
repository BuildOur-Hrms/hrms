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

async function main() {
  const log = (message: string) => console.log(`  ${message}`);
  console.log("\nSeeding HRMS\n");

  const inviteLinks: { label: string; email: string; url: string }[] = [];

  await withPlatform(
    async (db) => {
      // ── 1. permission catalog (global, not tenant-scoped)
      for (const permission of PERMISSIONS) {
        await db.permission.upsert({
          where: { code: permission.code },
          create: {
            code: permission.code,
            module: permission.module,
            action: permission.action,
          },
          update: { module: permission.module, action: permission.action },
        });
      }
      log(`permissions: ${PERMISSIONS.length}`);

      // ── 2. global settings defaults
      const globalKeys = SETTING_KEYS.filter((k) => SETTINGS_CATALOG[k].scope === "global");
      for (const key of globalKeys) {
        const existing = await db.systemSetting.findFirst({
          where: { key, companyId: null },
          select: { id: true },
        });
        if (!existing) {
          await db.systemSetting.create({
            data: { companyId: null, key, value: SETTINGS_CATALOG[key].default as never },
          });
        }
      }
      log(`global settings: ${globalKeys.length}`);

      // ── 3. pilot company
      const company = await db.company.upsert({
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
      });
      log(`company: ${company.name} (${company.slug})`);

      // ── 4. company settings defaults
      const companyKeys = SETTING_KEYS.filter((k) => SETTINGS_CATALOG[k].scope === "company");
      for (const key of companyKeys) {
        await db.systemSetting.upsert({
          where: { companyId_key: { companyId: company.id, key } },
          create: {
            companyId: company.id,
            key,
            value: SETTINGS_CATALOG[key].default as never,
          },
          update: {},
        });
      }
      log(`company settings: ${companyKeys.length}`);

      // ── 5. system roles and their grants
      const permissionIds = new Map(
        (await db.permission.findMany({ select: { id: true, code: true } })).map((p) => [
          p.code,
          p.id,
        ]),
      );

      for (const roleName of SYSTEM_ROLES) {
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

        const wanted = new Set(ROLE_PERMISSIONS[roleName]);

        // Replace the grant set rather than adding to it, so removing a
        // permission from the matrix actually revokes it on the next seed.
        await db.rolePermission.deleteMany({
          where: {
            roleId: role.id,
            permission: { code: { notIn: [...wanted] } },
          },
        });

        for (const code of wanted) {
          const permissionId = permissionIds.get(code);
          if (!permissionId) throw new Error(`Permission missing from catalog: ${code}`);
          await db.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: role.id, permissionId } },
            create: { roleId: role.id, permissionId },
            update: {},
          });
        }
        log(`role ${roleName}: ${wanted.size} permissions`);
      }

      const roleIds = new Map(
        (
          await db.role.findMany({
            where: { companyId: company.id },
            select: { id: true, name: true },
          })
        ).map((r) => [r.name, r.id]),
      );

      // ── 6. baseline org so an employee can be created on day one
      const location = await db.location.upsert({
        where: { companyId_code: { companyId: company.id, code: "HQ" } },
        create: { companyId: company.id, name: "Head Office", code: "HQ" },
        update: {},
        select: { id: true },
      });

      const adminDepartment = await db.department.upsert({
        where: { companyId_code: { companyId: company.id, code: "ADMIN" } },
        create: { companyId: company.id, name: "Administration", code: "ADMIN" },
        update: {},
        select: { id: true },
      });

      const adminDesignation = await db.designation.upsert({
        where: { companyId_code: { companyId: company.id, code: "ADMIN" } },
        create: { companyId: company.id, title: "Administrator", code: "ADMIN", level: 9 },
        update: {},
        select: { id: true },
      });
      log("org: Head Office / Administration / Administrator");

      // ── 7. administrator accounts, invited (never seeded with a password)
      async function inviteAdmin(email: string, roleName: "super_admin" | "hr_admin") {
        const normalised = email.toLowerCase();
        const user = await db.user.upsert({
          where: { companyId_email: { companyId: company.id, email: normalised } },
          create: { companyId: company.id, email: normalised, status: "invited" },
          update: {},
          select: { id: true, status: true, passwordHash: true },
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
      }

      const superAdminId = await inviteAdmin(env.SEED_ADMIN_EMAIL, "super_admin");
      const hrAdminId = await inviteAdmin(env.SEED_HR_EMAIL, "hr_admin");

      // Give the HR admin an employee record so self-service works for them.
      await db.employee.upsert({
        where: { companyId_employeeCode: { companyId: company.id, employeeCode: "EMP0001" } },
        create: {
          companyId: company.id,
          userId: hrAdminId,
          employeeCode: "EMP0001",
          firstName: "HR",
          lastName: "Admin",
          workEmail: env.SEED_HR_EMAIL.toLowerCase(),
          departmentId: adminDepartment.id,
          designationId: adminDesignation.id,
          locationId: location.id,
          employmentType: "full_time",
          status: "active",
          joinDate: new Date("2024-01-01T00:00:00.000Z"),
        },
        update: {},
      });
      log(`users: ${env.SEED_ADMIN_EMAIL} (super_admin), ${env.SEED_HR_EMAIL} (hr_admin)`);
      void superAdminId;

      // ── 8. demo organisation
      if (!env.SEED_DEMO) return;

      for (const dept of DEMO_DEPARTMENTS) {
        await db.department.upsert({
          where: { companyId_code: { companyId: company.id, code: dept.code } },
          create: { companyId: company.id, ...dept },
          update: {},
        });
      }
      for (const designation of DEMO_DESIGNATIONS) {
        await db.designation.upsert({
          where: { companyId_code: { companyId: company.id, code: designation.code } },
          create: { companyId: company.id, ...designation },
          update: {},
        });
      }
      log(`demo: ${DEMO_DEPARTMENTS.length} departments, ${DEMO_DESIGNATIONS.length} designations`);
    },
    { timeoutMs: 120_000 },
  );

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
