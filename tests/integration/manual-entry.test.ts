import { beforeAll, describe, expect, it } from "vitest";

import { POST as setLock } from "@/app/api/v1/attendance/locks/route";
import { POST as manualEntry } from "@/app/api/v1/attendance/manual/route";
import { withTenant } from "@/lib/db";
import { recomputeDay } from "@/modules/attendance/service";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * HR entering a day on somebody's behalf.
 *
 * The assertion that matters is the last one. A manual entry is stored as an
 * already-approved correction, because that is the only record `recomputeDay`
 * reads a status override back from — anything stored elsewhere is reverted
 * by the nightly job the same evening, silently, and nobody finds out until
 * payroll.
 */

/** A Monday well in the past, and in a month nothing else in the suite locks. */
const PAST_DAY = "2026-05-11";

let t: Tenants;

beforeAll(async () => {
  t = await seedTenants();
});

async function enter(body: Record<string, unknown>, as = t.acme.hr) {
  return call(manualEntry, "/api/v1/attendance/manual", { as, body });
}

describe("HR entering a day", () => {
  it("records the punches and settles the day", async () => {
    const result = await enter({
      employeeId: t.acme.employee.employeeId,
      workDate: PAST_DAY,
      checkIn: `${PAST_DAY}T03:30:00.000Z`,
      checkOut: `${PAST_DAY}T12:30:00.000Z`,
      reason: "Badge reader was down all morning",
    });

    expect(result.status, result.error?.message).toBe(201);

    const record = await withTenant(t.acme.companyId, (db) =>
      db.attendanceRecord.findFirst({
        where: {
          employeeId: t.acme.employee.employeeId,
          workDate: new Date(`${PAST_DAY}T00:00:00.000Z`),
        },
        select: { status: true, workedMinutes: true },
      }),
    );

    expect(record?.status).toBe("present");
    expect(record?.workedMinutes).toBeGreaterThan(0);
  });

  it("keeps the punches attributable to a person, not a clock", async () => {
    const punches = await withTenant(t.acme.companyId, (db) =>
      db.attendancePunch.findMany({
        where: { employeeId: t.acme.employee.employeeId },
        select: { source: true, createdBy: true },
      }),
    );

    expect(punches.length).toBeGreaterThan(0);
    for (const punch of punches) {
      expect(punch.source).toBe("manual");
      expect(punch.createdBy).toBe(t.acme.hr.userId);
    }
  });
});

describe("a status the punches cannot produce", () => {
  const leaveDay = "2026-05-12";

  it("is accepted", async () => {
    const result = await enter({
      employeeId: t.acme.employee.employeeId,
      workDate: leaveDay,
      status: "on_leave",
      reason: "Approved verbally before the system went in",
    });

    expect(result.status, result.error?.message).toBe(201);
  });

  it("survives the nightly rebuild", async () => {
    // The whole reason a manual entry is stored as an approved correction.
    // Without that, this recompute would find no punches and write `absent`.
    await withTenant(t.acme.companyId, (db) =>
      recomputeDay({ db, companyId: t.acme.companyId }, t.acme.employee.employeeId, leaveDay),
    );

    const record = await withTenant(t.acme.companyId, (db) =>
      db.attendanceRecord.findFirst({
        where: {
          employeeId: t.acme.employee.employeeId,
          workDate: new Date(`${leaveDay}T00:00:00.000Z`),
        },
        select: { status: true },
      }),
    );

    expect(record?.status).toBe("on_leave");
  });
});

describe("what it refuses", () => {
  it("refuses a manager", async () => {
    const result = await enter(
      {
        employeeId: t.acme.employee.employeeId,
        workDate: "2026-05-13",
        status: "present",
        reason: "Trying it on",
      },
      t.acme.manager,
    );

    expect(result.status).toBe(403);
  });

  it("refuses an employee from another company, without confirming they exist", async () => {
    const result = await enter({
      employeeId: t.globex.employee.employeeId,
      workDate: "2026-05-13",
      status: "present",
      reason: "Reaching across the boundary",
    });

    expect(result.status).toBe(404);
  });

  it("refuses a day that has not happened yet", async () => {
    const result = await enter({
      employeeId: t.acme.employee.employeeId,
      workDate: "2030-01-07",
      status: "present",
      reason: "Attendance in advance",
    });

    expect(result.status).toBe(409);
  });

  it("refuses a day before the employee joined", async () => {
    const result = await enter({
      employeeId: t.acme.employee.employeeId,
      workDate: "2020-01-06",
      status: "present",
      reason: "Before their time",
    });

    expect(result.status).toBe(409);
  });

  it("refuses an entry with neither a time nor a status", async () => {
    const result = await enter({
      employeeId: t.acme.employee.employeeId,
      workDate: "2026-05-13",
      reason: "Nothing in particular",
    });

    expect(result.status).toBe(400);
  });

  it("refuses a locked month", async () => {
    const locked = await call(setLock, "/api/v1/attendance/locks", {
      as: t.acme.hr,
      body: { year: 2026, month: 5, action: "lock" },
    });
    expect(locked.status, locked.error?.message).toBe(200);

    const result = await enter({
      employeeId: t.acme.employee.employeeId,
      workDate: "2026-05-13",
      status: "present",
      reason: "After payroll closed the month",
    });

    expect(result.status).toBe(409);
    expect(result.error?.message).toMatch(/lock/i);
  });
});
