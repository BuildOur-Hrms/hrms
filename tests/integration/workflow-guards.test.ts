import { beforeAll, describe, expect, it } from "vitest";

import { POST as setLock } from "@/app/api/v1/attendance/locks/route";
import { POST as punch } from "@/app/api/v1/attendance/punch/route";
import { POST as reviewLeave } from "@/app/api/v1/leave/requests/[id]/review/route";
import { DELETE as cancelLeave } from "@/app/api/v1/leave/requests/[id]/route";
import { POST as createLeaveRequest } from "@/app/api/v1/leave/requests/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Persona, type Tenants } from "./harness";

/**
 * The state guards from docs/07-workflows-and-automation.md §2, exercised
 * end to end.
 *
 * These are the rules an HR system is judged on. Approving your own leave is
 * the oldest hole there is, a manager reaching outside their team is the
 * second, and a locked month that still accepts punches makes payroll a
 * negotiation. None of them can be left to the screen to prevent.
 */

let t: Tenants;

beforeAll(async () => {
  t = await seedTenants();
  // A balance to spend, so an approval fails on the rule under test rather
  // than on having nothing to approve.
  await withPlatform((db) =>
    db.leaveBalance.createMany({
      data: [t.acme.employee, t.acme.hr, t.acme.manager].map((p) => ({
        companyId: t.acme.companyId,
        employeeId: p.employeeId,
        leaveTypeId: t.acme.leaveTypeId,
        year: 2026,
        opening: 12,
      })),
    }),
  );
});

async function submitLeave(as: Persona, start = "2026-09-01", end = "2026-09-01") {
  const result = await call<{ id: string }>(createLeaveRequest, "/api/v1/leave/requests", {
    as,
    body: {
      leaveTypeId: t.acme.leaveTypeId,
      startDate: start,
      endDate: end,
      reason: "Personal errand",
    },
  });
  expect(result.status, `${result.error?.code}: ${result.error?.message}`).toBe(201);
  return result.data.id;
}

describe("approving your own request", () => {
  it("is refused even for the person who can approve everyone else's", async () => {
    const id = await submitLeave(t.acme.hr, "2026-09-02", "2026-09-02");

    const review = await call(reviewLeave, `/api/v1/leave/requests/${id}/review`, {
      as: t.acme.hr,
      params: { id },
      body: { decision: "approved" },
    });

    expect(review.status).toBe(403);
    expect(review.error?.message).toMatch(/your own/i);
  });

  it("leaves the request pending afterwards", async () => {
    const id = await submitLeave(t.acme.manager, "2026-09-03", "2026-09-03");
    await call(reviewLeave, `/api/v1/leave/requests/${id}/review`, {
      as: t.acme.manager,
      params: { id },
      body: { decision: "approved" },
    });

    const row = await withPlatform((db) =>
      db.leaveRequest.findFirstOrThrow({ where: { id }, select: { status: true } }),
    );
    expect(row.status).toBe("pending");
  });
});

describe("a manager outside their team", () => {
  it("cannot review a request from someone who does not report to them", async () => {
    // The HR persona reports to nobody, so acme's manager has no claim on it.
    const id = await submitLeave(t.acme.hr, "2026-09-04", "2026-09-04");

    const review = await call(reviewLeave, `/api/v1/leave/requests/${id}/review`, {
      as: t.acme.manager,
      params: { id },
      body: { decision: "approved" },
    });

    expect(review.status).toBe(403);
    expect(review.error?.message).toMatch(/own team/i);
  });

  it("can review a request from a direct report", async () => {
    // A Monday. Every date in this file is a working day on purpose: the
    // day-count rejects a span that is entirely week-offs, which would fail
    // the request for the wrong reason.
    const id = await submitLeave(t.acme.employee, "2026-09-07", "2026-09-07");

    const review = await call(reviewLeave, `/api/v1/leave/requests/${id}/review`, {
      as: t.acme.manager,
      params: { id },
      body: { decision: "approved" },
    });

    expect(review.status, review.error?.message).toBe(200);
  });
});

describe("a request that has already been decided", () => {
  it("cannot be decided again", async () => {
    const id = await submitLeave(t.acme.employee, "2026-09-08", "2026-09-08");
    const first = await call(reviewLeave, `/api/v1/leave/requests/${id}/review`, {
      as: t.acme.manager,
      params: { id },
      body: { decision: "rejected" },
    });
    expect(first.status).toBe(200);

    const second = await call(reviewLeave, `/api/v1/leave/requests/${id}/review`, {
      as: t.acme.manager,
      params: { id },
      body: { decision: "approved" },
    });

    expect(second.status).toBe(409);
  });
});

describe("somebody else's request", () => {
  it("cannot be cancelled", async () => {
    const id = await submitLeave(t.acme.employee, "2026-09-09", "2026-09-09");

    const cancelled = await call(cancelLeave, `/api/v1/leave/requests/${id}`, {
      as: t.acme.manager,
      method: "DELETE",
      params: { id },
    });

    expect([403, 404]).toContain(cancelled.status);
  });
});

describe("a locked month", () => {
  it("rejects a punch", async () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const locked = await call(setLock, "/api/v1/attendance/locks", {
      as: t.acme.hr,
      body: { year, month, action: "lock" },
    });
    expect(locked.status, locked.error?.message).toBe(200);

    const punched = await call(punch, "/api/v1/attendance/punch", {
      as: t.acme.employee,
      body: { direction: "in" },
    });

    // A locked month is a conflict with the state of the world, not a bad
    // request: the punch is well-formed, the month simply will not take it.
    expect(punched.status).toBe(409);
    expect(punched.error?.message).toMatch(/lock/i);
  });

  it("accepts one again once reopened", async () => {
    const now = new Date();
    const reopened = await call(setLock, "/api/v1/attendance/locks", {
      as: t.acme.hr,
      body: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, action: "reopen" },
    });
    expect(reopened.status, reopened.error?.message).toBe(200);

    const punched = await call(punch, "/api/v1/attendance/punch", {
      as: t.acme.employee,
      body: { direction: "in" },
    });

    expect(punched.status, punched.error?.message).toBe(201);
  });
});
