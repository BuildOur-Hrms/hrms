import { describe, expect, it } from "vitest";

import { runDailyNotices } from "@/modules/notifications/daily";
import type { DataContext, NotifyInput } from "@/modules/notifications/service";

/**
 * The daily notice run decides two things that are easy to get quietly wrong:
 * who hears about a person's day, and whether running the job twice tells
 * everybody twice. Both are exercised here against a stub database, because
 * neither depends on Postgres to be right or wrong.
 */

interface StubEmployee {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string | null;
  dateOfBirth: Date | null;
  joinDate: Date;
  probationEndDate: Date | null;
  managerId: string | null;
  locationId: string;
}

interface StubHoliday {
  id: string;
  name: string;
  locationId: string | null;
  isOptional: boolean;
}

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function employee(overrides: Partial<StubEmployee> & { id: string }): StubEmployee {
  return {
    userId: `user-${overrides.id}`,
    firstName: overrides.id,
    lastName: null,
    dateOfBirth: null,
    joinDate: date("2020-03-01"),
    probationEndDate: null,
    managerId: null,
    locationId: "loc-1",
    ...overrides,
  };
}

function stub(options: {
  employees: StubEmployee[];
  hrUserIds?: string[];
  holidays?: StubHoliday[];
  existing?: { userId: string; type: string; title: string }[];
}) {
  const written: NotifyInput[] = [];

  const ctx = {
    companyId: "company-1",
    db: {
      employee: { findMany: async () => options.employees },
      user: { findMany: async () => (options.hrUserIds ?? []).map((id) => ({ id })) },
      // The email channel reads its policy from settings; an empty table
      // means the catalog defaults apply, which is what a new company has.
      systemSetting: { findMany: async () => [] },
      holiday: { findMany: async () => options.holidays ?? [] },
      notification: {
        findMany: async () => options.existing ?? [],
        createMany: async ({ data }: { data: NotifyInput[] }) => {
          written.push(...data);
          return { count: data.length };
        },
      },
    },
  } as unknown as DataContext;

  return { ctx, written };
}

const recipients = (written: NotifyInput[], type: string) =>
  written.filter((n) => n.type === type).map((n) => n.userId);

describe("birthdays and anniversaries", () => {
  const team = [
    employee({ id: "manager" }),
    employee({ id: "ana", managerId: "manager", dateOfBirth: date("1990-06-14") }),
    employee({ id: "ben", managerId: "manager" }),
    employee({ id: "outsider" }),
  ];

  it("tells the manager, the peers and HR — never the birthday person", async () => {
    const { ctx, written } = stub({ employees: team, hrUserIds: ["user-hr"] });
    const result = await runDailyNotices(ctx, "2026-06-14");

    expect(result.birthdays).toBe(1);
    expect(recipients(written, "birthday").sort()).toEqual(["user-ben", "user-hr", "user-manager"]);
  });

  it("keeps the birth year out of the message", async () => {
    const { ctx, written } = stub({ employees: team, hrUserIds: ["user-hr"] });
    await runDailyNotices(ctx, "2026-06-14");

    for (const notice of written) {
      expect(`${notice.title} ${notice.body}`).not.toContain("1990");
    }
  });

  it("does not congratulate anyone on the day they joined", async () => {
    const { ctx, written } = stub({
      employees: [employee({ id: "new", joinDate: date("2026-03-01"), managerId: "manager" })],
      hrUserIds: ["user-hr"],
    });
    const result = await runDailyNotices(ctx, "2026-03-01");

    expect(result.anniversaries).toBe(0);
    expect(recipients(written, "work_anniversary")).toEqual([]);
  });

  it("counts the years since joining", async () => {
    const { ctx, written } = stub({
      employees: [employee({ id: "ana", joinDate: date("2020-03-01") })],
      hrUserIds: ["user-hr"],
    });
    await runDailyNotices(ctx, "2026-03-01");

    expect(written.find((n) => n.type === "work_anniversary")?.title).toContain("6 years");
  });

  it("notifies about both people when two share a birthday", async () => {
    const { ctx, written } = stub({
      employees: [
        employee({ id: "ana", dateOfBirth: date("1990-06-14") }),
        employee({ id: "ben", dateOfBirth: date("1988-06-14") }),
      ],
      hrUserIds: ["user-hr"],
    });
    const result = await runDailyNotices(ctx, "2026-06-14");

    expect(result.birthdays).toBe(2);
    expect(recipients(written, "birthday")).toEqual(["user-hr", "user-hr"]);
  });
});

describe("probation endings", () => {
  const rookie = employee({
    id: "rookie",
    managerId: "manager",
    probationEndDate: date("2026-06-21"),
  });

  it("warns HR and the manager seven days out", async () => {
    const { ctx, written } = stub({
      employees: [rookie, employee({ id: "manager" })],
      hrUserIds: ["user-hr"],
    });
    const result = await runDailyNotices(ctx, "2026-06-14");

    expect(result.probationEnding).toBe(1);
    expect(recipients(written, "probation.ending").sort()).toEqual(["user-hr", "user-manager"]);
    expect(written.find((n) => n.type === "probation.ending")?.link).toBe("/hr/employees/rookie");
  });

  it("stays quiet on every other day", async () => {
    for (const today of ["2026-06-13", "2026-06-15", "2026-06-21"]) {
      const { ctx, written } = stub({ employees: [rookie], hrUserIds: ["user-hr"] });
      await runDailyNotices(ctx, today);
      expect(recipients(written, "probation.ending")).toEqual([]);
    }
  });
});

describe("upcoming holidays", () => {
  const staff = [
    employee({ id: "ana", locationId: "loc-1" }),
    employee({ id: "ben", locationId: "loc-2" }),
    employee({ id: "ghost", userId: null, locationId: "loc-1" }),
  ];

  it("tells everybody about a company-wide holiday, except accounts nobody holds", async () => {
    const { ctx, written } = stub({
      employees: staff,
      holidays: [{ id: "h1", name: "Diwali", locationId: null, isOptional: false }],
    });
    const result = await runDailyNotices(ctx, "2026-06-14");

    expect(result.upcomingHolidays).toBe(1);
    expect(recipients(written, "holiday.upcoming").sort()).toEqual(["user-ana", "user-ben"]);
  });

  it("tells only that location about a location holiday", async () => {
    const { ctx, written } = stub({
      employees: staff,
      holidays: [{ id: "h1", name: "Founders Day", locationId: "loc-2", isOptional: true }],
    });
    await runDailyNotices(ctx, "2026-06-14");

    expect(recipients(written, "holiday.upcoming")).toEqual(["user-ben"]);
  });
});

describe("running twice", () => {
  it("writes nothing the second time", async () => {
    const employees = [employee({ id: "ana", dateOfBirth: date("1990-06-14") })];

    const first = stub({ employees, hrUserIds: ["user-hr"] });
    await runDailyNotices(first.ctx, "2026-06-14");
    expect(first.written).toHaveLength(1);

    const second = stub({
      employees,
      hrUserIds: ["user-hr"],
      existing: first.written.map((n) => ({
        userId: n.userId,
        type: n.type,
        title: n.title,
      })),
    });
    await runDailyNotices(second.ctx, "2026-06-14");
    expect(second.written).toEqual([]);
  });
});
