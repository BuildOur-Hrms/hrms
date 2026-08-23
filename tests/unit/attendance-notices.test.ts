import { describe, expect, it } from "vitest";

import { sendAttendanceNotices } from "@/modules/attendance/notices";
import type { DataContext, NotifyInput } from "@/modules/notifications/service";

/**
 * Who hears about a settled day. The rules are small and the consequences are
 * not: telling a manager somebody was absent when they were on approved leave
 * is the kind of mistake that ends up in a conversation.
 */

interface StubRecord {
  status: string;
  lateMinutes: number;
  firstIn: Date | null;
  lastOut: Date | null;
  employee: {
    firstName: string;
    lastName: string | null;
    userId: string | null;
    manager: { userId: string | null } | null;
  };
}

const IN = new Date("2026-06-14T03:30:00.000Z");
const OUT = new Date("2026-06-14T12:30:00.000Z");
const SINCE = new Date("2026-06-15T00:00:00.000Z");

function record(overrides: Partial<StubRecord> = {}): StubRecord {
  return {
    status: "present",
    lateMinutes: 0,
    firstIn: IN,
    lastOut: OUT,
    employee: {
      firstName: "Ana",
      lastName: null,
      userId: "user-ana",
      manager: { userId: "user-manager" },
    },
    ...overrides,
  };
}

function stub(
  records: StubRecord[],
  existing: { userId: string; type: string; title: string }[] = [],
) {
  const written: NotifyInput[] = [];

  const ctx = {
    companyId: "company-1",
    db: {
      attendanceRecord: { findMany: async () => records },
      // notify() resolves email addresses for the notices that also send one.
      user: { findMany: async () => [] },
      notification: {
        findMany: async () => existing,
        createMany: async ({ data }: { data: NotifyInput[] }) => {
          written.push(...data);
          return { count: data.length };
        },
      },
    },
  } as unknown as DataContext;

  return { ctx, written };
}

const of = (written: NotifyInput[], type: string) =>
  written.filter((n) => n.type === type).map((n) => n.userId);

describe("late notices", () => {
  it("tells the person and their manager", async () => {
    const { ctx, written } = stub([record({ lateMinutes: 22 })]);
    const result = await sendAttendanceNotices(ctx, "2026-06-14", SINCE);

    expect(result.late).toBe(1);
    expect(of(written, "attendance.late").sort()).toEqual(["user-ana", "user-manager"]);
  });

  it("says nothing when the day was on time", async () => {
    const { ctx, written } = stub([record()]);
    const result = await sendAttendanceNotices(ctx, "2026-06-14", SINCE);

    expect(result.late).toBe(0);
    expect(written).toEqual([]);
  });

  it("ignores late minutes on a day that was not worked", async () => {
    const { ctx, written } = stub([
      record({ status: "on_leave", lateMinutes: 40, firstIn: null, lastOut: null }),
    ]);
    const result = await sendAttendanceNotices(ctx, "2026-06-14", SINCE);

    expect(result.late).toBe(0);
    expect(written).toEqual([]);
  });
});

describe("absence notices", () => {
  it("tells the person and their manager", async () => {
    const { ctx, written } = stub([record({ status: "absent", firstIn: null, lastOut: null })]);
    const result = await sendAttendanceNotices(ctx, "2026-06-14", SINCE);

    expect(result.absent).toBe(1);
    expect(of(written, "attendance.absent_no_leave").sort()).toEqual(["user-ana", "user-manager"]);
  });

  it("stays quiet for approved leave, a holiday and a week off", async () => {
    const { ctx, written } = stub(
      ["on_leave", "holiday", "week_off"].map((status) =>
        record({ status, firstIn: null, lastOut: null }),
      ),
    );
    const result = await sendAttendanceNotices(ctx, "2026-06-14", SINCE);

    expect(result.absent).toBe(0);
    expect(written).toEqual([]);
  });
});

describe("missing check-out", () => {
  it("goes only to the person who forgot", async () => {
    const { ctx, written } = stub([record({ lastOut: null })]);
    const result = await sendAttendanceNotices(ctx, "2026-06-14", SINCE);

    expect(result.missingCheckout).toBe(1);
    expect(of(written, "attendance.missing_checkout")).toEqual(["user-ana"]);
  });

  it("is not raised for a day with no punches at all", async () => {
    const { ctx } = stub([record({ status: "absent", firstIn: null, lastOut: null })]);
    const result = await sendAttendanceNotices(ctx, "2026-06-14", SINCE);

    expect(result.missingCheckout).toBe(0);
  });
});

describe("people with no account", () => {
  it("are skipped without dropping their manager's notice", async () => {
    const { ctx, written } = stub([
      record({
        status: "absent",
        firstIn: null,
        lastOut: null,
        employee: {
          firstName: "Ghost",
          lastName: null,
          userId: null,
          manager: { userId: "user-manager" },
        },
      }),
    ]);
    await sendAttendanceNotices(ctx, "2026-06-14", SINCE);

    expect(of(written, "attendance.absent_no_leave")).toEqual(["user-manager"]);
  });
});

describe("re-running the day", () => {
  it("writes nothing the second time", async () => {
    const records = [record({ lateMinutes: 15 })];

    const first = stub(records);
    await sendAttendanceNotices(first.ctx, "2026-06-14", SINCE);
    expect(first.written).toHaveLength(2);

    const second = stub(
      records,
      first.written.map((n) => ({ userId: n.userId, type: n.type, title: n.title })),
    );
    await sendAttendanceNotices(second.ctx, "2026-06-14", SINCE);
    expect(second.written).toEqual([]);
  });
});
