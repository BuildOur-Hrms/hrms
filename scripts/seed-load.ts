import "dotenv/config";

import { withPlatform } from "../src/lib/db.ts";
import { env } from "../src/lib/env.ts";
import {
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from "../src/lib/permissions.ts";

/**
 * The standing performance fixture: a company of 500 people with a real
 * month of attendance behind them (docs/10-roadmap-testing-deployment.md §3).
 *
 *   npm run db:seed-load                  # 500 employees, 1 month
 *   npm run db:seed-load -- --employees=2000 --months=3
 *
 * Written as bulk inserts rather than per-row creates for the same reason the
 * main seed is: the row count is large but the round-trip count is what
 * decides whether this takes ten seconds or ten minutes.
 *
 * Every generated record is fake and obviously so — names are `Load NNN`, the
 * company slug is prefixed `load-` — because a performance fixture that looks
 * like real data is a performance fixture somebody eventually mistakes for
 * real data.
 */

const DEPARTMENTS = ["Engineering", "Sales", "Support", "Finance", "People"];
const DESIGNATIONS = ["Associate", "Senior Associate", "Lead", "Manager"];
const LOCATIONS = ["Bengaluru", "Pune", "Remote"];

/** One manager per this many people, so the team-scoped paths have real fan-out. */
const TEAM_SIZE = 12;

function arg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Deterministic pseudo-randomness: the same fixture every run, no seeds file. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

async function main() {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to write a load fixture into production");
  }

  const employeeCount = arg("employees", 500);
  const months = arg("months", 1);
  const slug = `load-${employeeCount}`;

  console.log(`\nLoad fixture: ${employeeCount} employees, ${months} month(s) of attendance\n`);
  const started = Date.now();

  await withPlatform((db) =>
    db.permission.createMany({
      data: PERMISSIONS.map((p) => ({ code: p.code, module: p.module, action: p.action })),
      skipDuplicates: true,
    }),
  );

  const existing = await withPlatform((db) =>
    db.company.findFirst({ where: { slug }, select: { id: true } }),
  );
  if (existing) {
    throw new Error(
      `A company with slug "${slug}" already exists. Drop it first, or pass a different --employees.`,
    );
  }

  const company = await withPlatform((db) =>
    db.company.create({
      data: {
        name: `Load Test ${employeeCount}`,
        slug,
        timezone: "Asia/Kolkata",
        currency: "INR",
        status: "active",
      },
      select: { id: true },
    }),
  );
  const companyId = company.id;
  console.log(`  company: ${slug}`);

  // ── org structure
  const org = await withPlatform(async (db) => {
    await db.location.createMany({
      data: LOCATIONS.map((name, i) => ({ companyId, name, code: `L${i + 1}` })),
    });
    await db.department.createMany({
      data: DEPARTMENTS.map((name, i) => ({ companyId, name, code: `D${i + 1}` })),
    });
    await db.designation.createMany({
      data: DESIGNATIONS.map((title, i) => ({ companyId, title, code: `T${i + 1}`, level: i + 1 })),
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
      data: { companyId, name: "Casual", code: "CL", isPaid: true },
      select: { id: true },
    });

    const [locations, departments, designations] = await Promise.all([
      db.location.findMany({ where: { companyId }, select: { id: true } }),
      db.department.findMany({ where: { companyId }, select: { id: true } }),
      db.designation.findMany({ where: { companyId }, select: { id: true } }),
    ]);
    return {
      locations: locations.map((r) => r.id),
      departments: departments.map((r) => r.id),
      designations: designations.map((r) => r.id),
      shiftId: shift.id,
      leaveTypeId: leaveType.id,
    };
  });

  // ── roles
  await withPlatform(async (db) => {
    const permissions = await db.permission.findMany({ select: { id: true, code: true } });
    const idOf = new Map(permissions.map((p) => [p.code, p.id]));

    for (const name of SYSTEM_ROLES) {
      const role = await db.role.create({
        data: { companyId, name, description: ROLE_DESCRIPTIONS[name], isSystem: true },
        select: { id: true },
      });
      await db.rolePermission.createMany({
        data: ROLE_PERMISSIONS[name].map((code) => ({
          roleId: role.id,
          permissionId: idOf.get(code)!,
        })),
      });
    }
  });

  // ── employees, managers first so the reporting lines resolve
  const managerCount = Math.max(1, Math.ceil(employeeCount / TEAM_SIZE));
  const joinDate = dateOnly("2024-01-01");

  const managerIds = await withPlatform(async (db) => {
    await db.employee.createMany({
      data: Array.from({ length: managerCount }, (_, i) => ({
        companyId,
        employeeCode: `MGR-${String(i + 1).padStart(4, "0")}`,
        firstName: "Manager",
        lastName: String(i + 1),
        departmentId: org.departments[i % org.departments.length]!,
        designationId: org.designations[org.designations.length - 1]!,
        locationId: org.locations[i % org.locations.length]!,
        employmentType: "full_time" as const,
        status: "active" as const,
        joinDate,
      })),
    });
    const rows = await db.employee.findMany({
      where: { companyId, employeeCode: { startsWith: "MGR-" } },
      select: { id: true },
      orderBy: { employeeCode: "asc" },
    });
    return rows.map((r) => r.id);
  });
  console.log(`  managers: ${managerIds.length}`);

  const BATCH = 500;
  for (let start = 0; start < employeeCount; start += BATCH) {
    const size = Math.min(BATCH, employeeCount - start);
    await withPlatform((db) =>
      db.employee.createMany({
        data: Array.from({ length: size }, (_, k) => {
          const i = start + k;
          return {
            companyId,
            employeeCode: `EMP-${String(i + 1).padStart(5, "0")}`,
            firstName: "Load",
            lastName: String(i + 1),
            departmentId: org.departments[i % org.departments.length]!,
            designationId: org.designations[i % org.designations.length]!,
            locationId: org.locations[i % org.locations.length]!,
            managerId: managerIds[i % managerIds.length]!,
            employmentType: "full_time" as const,
            status: "active" as const,
            joinDate,
            dateOfBirth: dateOnly(
              `199${i % 10}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
            ),
          };
        }),
      }),
    );
  }
  console.log(`  employees: ${employeeCount}`);

  const everyone = await withPlatform((db) =>
    db.employee.findMany({ where: { companyId }, select: { id: true } }),
  );

  // ── leave balances, one per person
  await withPlatform((db) =>
    db.leaveBalance.createMany({
      data: everyone.map((e) => ({
        companyId,
        employeeId: e.id,
        leaveTypeId: org.leaveTypeId,
        year: new Date().getUTCFullYear(),
        opening: 12,
        accrued: 6,
        used: 3,
      })),
    }),
  );
  console.log(`  leave balances: ${everyone.length}`);

  // ── attendance: the fixture the month view and the reports are measured on
  const today = new Date();
  let records = 0;

  for (let m = 0; m < months; m++) {
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 1));
    const daysInMonth = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
    ).getUTCDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const workDate = new Date(
        Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day),
      );
      if (workDate > today) break;

      const weekday = workDate.getUTCDay();
      const rows = everyone.map((employee, i) => {
        const roll = hash(i + day * 31 + m * 977);
        const weekOff = weekday === 0 || weekday === 6;
        const status = weekOff
          ? ("week_off" as const)
          : roll < 0.04
            ? ("absent" as const)
            : roll < 0.08
              ? ("on_leave" as const)
              : roll < 0.12
                ? ("half_day" as const)
                : ("present" as const);

        const worked = status === "present" ? 510 : status === "half_day" ? 240 : 0;
        const late = status === "present" && roll > 0.85 ? Math.round(roll * 40) : 0;

        return {
          companyId,
          employeeId: employee.id,
          workDate,
          status,
          workedMinutes: worked,
          lateMinutes: late,
          overtimeMinutes: status === "present" && roll > 0.95 ? 60 : 0,
          firstIn: worked ? new Date(workDate.getTime() + 3.5 * 3_600_000) : null,
          lastOut: worked ? new Date(workDate.getTime() + 12.5 * 3_600_000) : null,
        };
      });

      for (let start = 0; start < rows.length; start += BATCH) {
        await withPlatform((db) =>
          db.attendanceRecord.createMany({ data: rows.slice(start, start + BATCH) }),
        );
      }
      records += rows.length;
    }
  }

  console.log(`  attendance records: ${records}`);
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. Company slug: ${slug}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
