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
    /*
     * Not an upsert, for the same reason the three above are not.
     *
     * `leave_types_company_id_code_key` is partial — `WHERE deleted_at IS
     * NULL`, so a retired code can be used again — and Postgres will not use
     * a partial index for `ON CONFLICT` unless the statement repeats the
     * predicate, which Prisma's upsert does not.
     */
    const existingLeaveType = await db.leaveType.findFirst({
      where: { companyId, code: "CL" },
      select: { id: true, deletedAt: true },
    });
    const leaveType = existingLeaveType
      ? await db.leaveType.update({
          where: { id: existingLeaveType.id },
          // A previous run may have archived it; the fixture wants it live.
          data: { deletedAt: null },
          select: { id: true },
        })
      : await db.leaveType.create({
          data: { companyId, name: "Casual leave", code: "CL", isPaid: true },
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
            data: {
              userId: user.id,
              managerId,
              status: "active",
              /*
               * Back to the state an invited account actually arrives in, so
               * the post-invite setup journey is repeatable rather than
               * passing exactly once.
               *
               * Except HR. The setup journey needs the employee and the
               * manager unstamped, and any other spec visiting a profile
               * would otherwise meet the welcome form instead — which made
               * one spec depend on another having run first.
               */
              profileCompletedAt: role === "hr_admin" ? new Date() : null,
              firstName,
              lastName: "Tester",
              phone: null,
              personalEmail: null,
              dateOfBirth: null,
              gender: null,
              address: null,
            },
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
              // Same rule as the update above. CI starts from an empty
              // database and only ever takes this branch, so leaving it out
              // here made the fixture mean one thing locally and another in
              // the run that matters.
              profileCompletedAt: role === "hr_admin" ? new Date() : null,
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
  const hrUserId = await withPlatform(async (db) => {
    const user = await db.user.findFirstOrThrow({
      where: { companyId, email: E2E_USERS.hr },
      select: { id: true },
    });
    return user.id;
  });
  const employeeId = await account("employee", E2E_USERS.employee, "Eli", managerEmployeeId);

  /*
   * The two halves of an account that was invited directly: a login with no
   * employee record, and a record with no login. Reset every run — the
   * journey links them, and a linked pair gives the next run nothing to do.
   */
  await withPlatform(async (db) => {
    const stray = await db.user.upsert({
      where: { companyId_email: { companyId, email: `stray@${E2E_SLUG}.test` } },
      create: { companyId, email: `stray@${E2E_SLUG}.test`, passwordHash, status: "active" },
      update: { status: "active" },
      select: { id: true },
    });
    // Detach it from whatever a previous run linked it to.
    await db.employee.updateMany({ where: { userId: stray.id }, data: { userId: null } });

    /*
     * A second one, for the journey that creates the record from the Users
     * screen rather than attaching an existing one.
     *
     * That journey leaves a whole employee behind, so this removes it — a
     * hard delete, which is safe only because a record created seconds ago
     * has no attendance or leave hanging off it. Anywhere else this would be
     * an archive.
     */
    const second = await db.user.upsert({
      where: { companyId_email: { companyId, email: `stray2@${E2E_SLUG}.test` } },
      create: { companyId, email: `stray2@${E2E_SLUG}.test`, passwordHash, status: "active" },
      update: { status: "active" },
      select: { id: true },
    });
    await db.employee.deleteMany({ where: { userId: second.id } });

    const existing = await db.employee.findFirst({
      where: { companyId, employeeCode: "E2E-UNLINKED" },
      select: { id: true },
    });
    const data = {
      firstName: "Unlinked",
      lastName: "Person",
      status: "active" as const,
      userId: null,
      departmentId: org.departmentId,
      designationId: org.designationId,
      locationId: org.locationId,
      employmentType: "full_time" as const,
      joinDate: JOIN_DATE,
    };
    if (existing) {
      await db.employee.update({ where: { id: existing.id }, data });
    } else {
      await db.employee.create({
        data: { companyId, employeeCode: "E2E-UNLINKED", ...data },
      });
    }
  });

  /*
   * Somebody arriving, with a checklist to follow.
   *
   * Reset each run — the journey starts a checklist and activates them, and
   * an employee who is already active gives the next run nothing to do.
   */
  await withPlatform(async (db) => {
    const existing = await db.employee.findFirst({
      where: { companyId, employeeCode: "E2E-JOINER" },
      select: { id: true },
    });
    const joinDate = new Date();
    joinDate.setUTCDate(joinDate.getUTCDate() + 7);
    const data = {
      firstName: "Nadia",
      lastName: "Arrives",
      status: "onboarding" as const,
      departmentId: org.departmentId,
      designationId: org.designationId,
      locationId: org.locationId,
      managerId: managerEmployeeId,
      employmentType: "full_time" as const,
      joinDate,
    };
    const joiner = existing
      ? await db.employee.update({ where: { id: existing.id }, data, select: { id: true } })
      : await db.employee.create({
          data: { companyId, employeeCode: "E2E-JOINER", ...data },
          select: { id: true },
        });

    // Whatever a previous run started.
    await db.checklistTask.deleteMany({ where: { employeeId: joiner.id } });

    const template = await db.checklistTemplate.findFirst({
      where: { companyId, kind: "onboarding", name: "E2E joiner checklist" },
      select: { id: true },
    });
    if (!template) {
      await db.checklistTemplate.create({
        data: {
          companyId,
          kind: "onboarding",
          name: "E2E joiner checklist",
          isDefault: true,
          tasks: {
            create: [
              {
                companyId,
                title: "Laptop ready",
                assignee: "it",
                dueOffsetDays: -2,
                sortOrder: 1,
              },
              {
                companyId,
                title: "Sign the contract",
                assignee: "employee",
                dueOffsetDays: 0,
                sortOrder: 2,
              },
              {
                companyId,
                title: "Team lunch",
                assignee: "manager",
                dueOffsetDays: 7,
                isRequired: false,
                sortOrder: 3,
              },
            ],
          },
        },
      });
    }
  });

  /*
   * Somebody on the way out, with an exit checklist to follow.
   *
   * Their own record rather than one of the personas: the journey ends with
   * the person exited and their login disabled, and doing that to a persona
   * would take every other spec down with it.
   */
  await withPlatform(async (db) => {
    const existing = await db.employee.findFirst({
      where: { companyId, employeeCode: "E2E-LEAVER" },
      select: { id: true },
    });
    const data = {
      firstName: "Rowan",
      lastName: "Departs",
      status: "active" as const,
      exitDate: null,
      departmentId: org.departmentId,
      designationId: org.designationId,
      locationId: org.locationId,
      managerId: managerEmployeeId,
      employmentType: "full_time" as const,
      joinDate: JOIN_DATE,
    };
    const leaver = existing
      ? await db.employee.update({ where: { id: existing.id }, data, select: { id: true } })
      : await db.employee.create({
          data: { companyId, employeeCode: "E2E-LEAVER", ...data },
          select: { id: true },
        });

    // Whatever a previous run left behind. Tasks first: they point at the
    // request, and the request will not go while they hold it.
    await db.checklistTask.deleteMany({ where: { employeeId: leaver.id, kind: "offboarding" } });
    await db.offboardingRequest.deleteMany({ where: { employeeId: leaver.id } });

    const template = await db.checklistTemplate.findFirst({
      where: { companyId, kind: "offboarding", name: "E2E exit checklist" },
      select: { id: true },
    });
    if (!template) {
      await db.checklistTemplate.create({
        data: {
          companyId,
          kind: "offboarding",
          name: "E2E exit checklist",
          isDefault: true,
          tasks: {
            create: [
              {
                companyId,
                title: "Return the laptop",
                assignee: "employee",
                dueOffsetDays: -1,
                sortOrder: 1,
              },
              {
                companyId,
                title: "Revoke access",
                assignee: "it",
                dueOffsetDays: 0,
                sortOrder: 2,
              },
              {
                companyId,
                title: "Exit interview",
                assignee: "hr",
                dueOffsetDays: -3,
                isRequired: false,
                sortOrder: 3,
              },
            ],
          },
        },
      });
    }
  });

  /*
   * A review cycle, open for goals.
   *
   * Reset each run: the journey sets a goal, opens reviews and rates
   * somebody, and a cycle already at "closed" gives the next run nothing to
   * do. The goals go with it — they are job tasks with a cycle on them.
   */
  await withPlatform(async (db) => {
    const existing = await db.performanceCycle.findFirst({
      where: { companyId, name: "E2E cycle" },
      select: { id: true },
    });
    if (existing) {
      await db.jobTask.deleteMany({ where: { cycleId: existing.id } });
      await db.performanceReview.deleteMany({ where: { cycleId: existing.id } });
      await db.performanceCycle.update({
        where: { id: existing.id },
        data: { status: "active" },
      });
    } else {
      await db.performanceCycle.create({
        data: {
          companyId,
          name: "E2E cycle",
          periodStart: new Date("2027-01-01"),
          periodEnd: new Date("2027-06-30"),
          reviewDeadline: new Date("2027-07-15"),
          status: "active",
        },
      });
    }
  });

  /*
   * Topped back up, so the leave journey tests approval rather than rejection
   * however many times it has run before.
   *
   * This year and next. Balance is held per leave year, and the journey books
   * a day a couple of months out — which crosses into January for any run in
   * the last stretch of the year. Allocating both means the date the journey
   * picks never decides whether it passes.
   */
  const thisYear = new Date().getUTCFullYear();
  for (const year of [thisYear, thisYear + 1]) {
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
  }

  // ── tasks, with a few months behind them so the trend has a shape.
  //
  // The browser journey drives real controls against these rather than
  // creating its own: a fixture that cannot support the screens it exists for
  // is a fixture that gets worked around instead of fixed.
  const staff = await withPlatform((db) =>
    db.employee.findMany({ where: { companyId }, select: { id: true, firstName: true } }),
  );

  await withPlatform((db) => db.jobTask.deleteMany({ where: { companyId } }));

  // The hiring pipeline, cleared for the same reason: a journey that creates
  // a role each run leaves a board nobody can write a stable locator against.
  // Children first — offers and interviews hang off applications.
  await withPlatform(async (db) => {
    await db.offer.deleteMany({ where: { companyId } });
    await db.interview.deleteMany({ where: { companyId } });
    await db.application.deleteMany({ where: { companyId } });
    await db.candidate.deleteMany({ where: { companyId } });
    await db.jobPosting.deleteMany({ where: { companyId } });
  });

  const now = new Date();
  const window = [0, 1, 2, 3, 4, 5].map((back) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  });

  const TITLES = ["Close ten support tickets", "Ship the onboarding flow", "Write the runbook"];

  interface SeedTask {
    companyId: string;
    employeeId: string;
    createdBy: string;
    origin: "assigned" | "self";
    title: string;
    weight: number;
    progress: number;
    status: "completed" | "not_started" | "in_progress";
    completedAt: Date | null;
    year: number;
    month: number;
  }
  const tasks: SeedTask[] = [];

  for (const [person, employee] of staff.entries()) {
    for (const [back, period] of window.entries()) {
      for (let slot = 0; slot < TITLES.length; slot++) {
        // Deterministic rather than random: the same fixture every run, so a
        // failing assertion is a real change and not this month's dice.
        const progress =
          back === 0
            ? [0, 40, 75, 100][(person + slot) % 4]!
            : [100, 90, 60, 25][(person + slot + back) % 4]!;

        tasks.push({
          companyId,
          employeeId: employee.id,
          createdBy: hrUserId,
          // The last of the three is theirs, so both lists have something in
          // them and the split is visible on screen.
          origin: (slot === TITLES.length - 1 ? "self" : "assigned") as "self" | "assigned",
          title: `${TITLES[slot]} (${employee.firstName})`,
          weight: ((person + slot) % 3) + 1,
          progress,
          status: (progress === 100
            ? "completed"
            : progress === 0
              ? "not_started"
              : "in_progress") as "completed" | "not_started" | "in_progress",
          completedAt: progress === 100 ? new Date() : null,
          year: period.year,
          month: period.month,
        });
      }
    }
  }

  await withPlatform((db) => db.jobTask.createMany({ data: tasks }));
  console.log(`  tasks: ${tasks.length} across ${window.length} months`);

  /*
   * ── payroll: cleared rather than created.
   *
   * The payroll journey adds a salary component through the screens, which is
   * the point of it. Leaving that row behind means the next run's create hits
   * the unique code and the dialog refuses — a test that passes once and then
   * fails forever, for a reason that has nothing to do with the code.
   *
   * Hard delete, not archive: a soft-deleted row still occupies the code as
   * far as the service's duplicate check is concerned, which would leave the
   * same problem with an extra step.
   */
  await withPlatform(async (db) => {
    const codes = ["E2EBASIC"];
    const components = await db.salaryComponent.findMany({
      where: { companyId, code: { in: codes } },
      select: { id: true },
    });
    if (components.length === 0) return;
    const ids = components.map((component) => component.id);
    await db.payslipItem.deleteMany({ where: { componentId: { in: ids } } });
    await db.employeeSalaryItem.deleteMany({ where: { componentId: { in: ids } } });
    await db.salaryComponent.deleteMany({ where: { id: { in: ids } } });
    console.log(`  payroll: cleared ${ids.length} component(s) the journey creates`);
  });

  /*
   * ── roles: the journey creates one, and deletes it again.
   *
   * Cleared anyway, because a run that fails partway leaves the role behind
   * and the next create then hits the unique name.
   */
  await withPlatform(async (db) => {
    const roles = await db.role.findMany({
      where: { companyId, isSystem: false, name: { in: ["e2erecruiter"] } },
      select: { id: true },
    });
    if (roles.length === 0) return;
    const ids = roles.map((role) => role.id);
    await db.userRole.deleteMany({ where: { roleId: { in: ids } } });
    await db.rolePermission.deleteMany({ where: { roleId: { in: ids } } });
    await db.role.deleteMany({ where: { id: { in: ids } } });
    console.log(`  roles: cleared ${ids.length} custom role(s) the journey creates`);
  });

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
