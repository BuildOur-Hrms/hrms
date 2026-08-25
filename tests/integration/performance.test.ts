import { beforeAll, describe, expect, it } from "vitest";

import { GET as listCycles, POST as createCycle } from "@/app/api/v1/performance/cycles/route";
import { POST as approveGoals } from "@/app/api/v1/performance/cycles/[id]/goals/approve/route";
import { GET as getGoals, POST as addGoal } from "@/app/api/v1/performance/cycles/[id]/goals/route";
import { POST as setCycleStatus } from "@/app/api/v1/performance/cycles/[id]/status/route";
import { GET as cycleSummary } from "@/app/api/v1/performance/cycles/[id]/summary/route";
import { GET as listReviews } from "@/app/api/v1/performance/reviews/route";
import { POST as finalRating } from "@/app/api/v1/performance/reviews/[id]/final/route";
import { POST as managerReview } from "@/app/api/v1/performance/reviews/[id]/manager/route";
import { POST as reopenReview } from "@/app/api/v1/performance/reviews/[id]/reopen/route";
import { POST as selfReview } from "@/app/api/v1/performance/reviews/[id]/self/route";
import { GET as monthlyTasks } from "@/app/api/v1/tasks/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * Performance, end to end.
 *
 * Two things are worth proving against a real database. That neither half of
 * a review can be written by the wrong person — a review belongs to two
 * people and "manager" is a relationship, not a rank. And that goals stay out
 * of the monthly task figure, which is the price paid for reusing one table
 * for both.
 */

let t: Tenants;
let cycleId: string;

beforeAll(async () => {
  t = await seedTenants();

  const result = await call<{ id: string }>(createCycle, "/api/v1/performance/cycles", {
    as: t.acme.hr,
    method: "POST",
    body: {
      name: "H1 2027",
      periodStart: "2027-01-01",
      periodEnd: "2027-06-30",
      reviewDeadline: "2027-07-15",
    },
  });
  cycleId = result.data.id;
});

describe("running a cycle", () => {
  it("is not something an employee can start", async () => {
    const result = await call(createCycle, "/api/v1/performance/cycles", {
      as: t.acme.employee,
      method: "POST",
      body: { name: "Mine", periodStart: "2027-01-01", periodEnd: "2027-06-30" },
    });

    expect(result.status).toBe(403);
  });

  it("refuses a period that ends before it starts", async () => {
    const result = await call(createCycle, "/api/v1/performance/cycles", {
      as: t.acme.hr,
      method: "POST",
      body: { name: "Backwards", periodStart: "2027-06-30", periodEnd: "2027-01-01" },
    });

    expect(result.status).toBe(400);
  });

  it("is visible to an employee, who needs to know which one is open", async () => {
    const result = await call<{ id: string }[]>(listCycles, "/api/v1/performance/cycles", {
      as: t.acme.employee,
    });

    expect(result.status).toBe(200);
    expect(result.data.map((row) => row.id)).toContain(cycleId);
  });

  it("shows the other tenant nothing", async () => {
    const result = await call<{ id: string }[]>(listCycles, "/api/v1/performance/cycles", {
      as: t.globex.hr,
    });

    expect(result.data.map((row) => row.id)).not.toContain(cycleId);
  });

  it("refuses to skip straight to reviews", async () => {
    const result = await call(setCycleStatus, `/api/v1/performance/cycles/${cycleId}/status`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: cycleId },
      body: { status: "review" },
    });

    expect(result.status).toBe(422);
  });

  it("activates", async () => {
    const result = await call<{ status: string }>(
      setCycleStatus,
      `/api/v1/performance/cycles/${cycleId}/status`,
      {
        as: t.acme.hr,
        method: "POST",
        params: { id: cycleId },
        body: { status: "active" },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("active");
  });
});

describe("goals", () => {
  it("are set by the person they belong to", async () => {
    const result = await call<{ id: string }>(
      addGoal,
      `/api/v1/performance/cycles/${cycleId}/goals`,
      {
        as: t.acme.employee,
        method: "POST",
        params: { id: cycleId },
        body: { title: "Ship the reporting rewrite", weight: 3 },
      },
    );

    expect(result.status, result.error?.message).toBe(201);
  });

  it("can be set for a report by their manager", async () => {
    const result = await call(addGoal, `/api/v1/performance/cycles/${cycleId}/goals`, {
      as: t.acme.manager,
      method: "POST",
      params: { id: cycleId },
      body: {
        employeeId: t.acme.employee.employeeId,
        title: "Mentor the new joiner",
        weight: 1,
      },
    });

    expect(result.status, result.error?.message).toBe(201);
  });

  it("cannot be set for somebody who is not your report", async () => {
    const result = await call(addGoal, `/api/v1/performance/cycles/${cycleId}/goals`, {
      as: t.acme.employee,
      method: "POST",
      params: { id: cycleId },
      body: { employeeId: t.acme.manager.employeeId, title: "Not mine to set" },
    });

    expect(result.status).toBe(403);
  });

  it("are weighted as a set, and unapproved until somebody agrees them", async () => {
    const result = await call<{ progress: number; approved: boolean; goals: unknown[] }>(
      getGoals,
      `/api/v1/performance/cycles/${cycleId}/goals`,
      { as: t.acme.employee, params: { id: cycleId } },
    );

    expect(result.status).toBe(200);
    expect(result.data.goals).toHaveLength(2);
    expect(result.data.progress).toBe(0);
    expect(result.data.approved).toBe(false);
  });

  it("cannot be agreed by an employee at all, who holds no approval", async () => {
    const result = await call(approveGoals, `/api/v1/performance/cycles/${cycleId}/goals/approve`, {
      as: t.acme.employee,
      method: "POST",
      params: { id: cycleId },
      body: { employeeId: t.acme.employee.employeeId },
    });

    expect(result.status).toBe(403);
  });

  it("cannot be agreed by the person whose goals they are, permission or not", async () => {
    // The manager does hold approval, so this is the rule itself refusing
    // rather than the gate in front of it.
    await call(addGoal, `/api/v1/performance/cycles/${cycleId}/goals`, {
      as: t.acme.manager,
      method: "POST",
      params: { id: cycleId },
      body: { title: "Grow the team", weight: 2 },
    });

    const result = await call(approveGoals, `/api/v1/performance/cycles/${cycleId}/goals/approve`, {
      as: t.acme.manager,
      method: "POST",
      params: { id: cycleId },
      body: { employeeId: t.acme.manager.employeeId },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/your own/i);
  });

  it("are agreed by the manager, as a set", async () => {
    const result = await call<{ approved: number }>(
      approveGoals,
      `/api/v1/performance/cycles/${cycleId}/goals/approve`,
      {
        as: t.acme.manager,
        method: "POST",
        params: { id: cycleId },
        body: { employeeId: t.acme.employee.employeeId },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.approved).toBe(2);
  });

  it("stay out of the monthly task figure", async () => {
    /*
     * The price of one table for both. A half-year goal at 0% must not drag
     * somebody's January down — the monthly number answers a different
     * question and has a different denominator.
     */
    const result = await call<{ tasks: { title: string }[] }>(monthlyTasks, "/api/v1/tasks", {
      as: t.acme.employee,
      query: {
        year: "2027",
        month: "1",
        employeeId: t.acme.employee.employeeId,
      },
    });

    expect(result.status, result.error?.message).toBe(200);
    // The goals were anchored to January 2027, the month their cycle starts,
    // and this is January 2027 asked for by name.
    const titles = (result.data.tasks ?? []).map((task) => task.title);
    expect(titles).not.toContain("Ship the reporting rewrite");
    expect(titles).not.toContain("Mentor the new joiner");
  });
});

describe("the two halves of a review", () => {
  let reviewId: string;

  beforeAll(async () => {
    await call(setCycleStatus, `/api/v1/performance/cycles/${cycleId}/status`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: cycleId },
      body: { status: "review" },
    });

    const rows = await withPlatform((db) =>
      db.performanceReview.findMany({
        where: { cycleId, employeeId: t.acme.employee.employeeId },
        select: { id: true, managerId: true },
      }),
    );
    reviewId = rows[0]!.id;
    // Opened against the manager the person had at the time.
    expect(rows[0]!.managerId).toBe(t.acme.manager.employeeId);
  });

  it("will not let a manager write somebody's self review", async () => {
    const result = await call(selfReview, `/api/v1/performance/reviews/${reviewId}/self`, {
      as: t.acme.manager,
      method: "POST",
      params: { id: reviewId },
      body: { rating: 5, comments: "Writing this for them." },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/person it is about/i);
  });

  it("will not let HR write it either, permissions notwithstanding", async () => {
    const result = await call(selfReview, `/api/v1/performance/reviews/${reviewId}/self`, {
      as: t.acme.hr,
      method: "POST",
      params: { id: reviewId },
      body: { rating: 5, comments: "Nor this." },
    });

    expect(result.status).toBe(422);
  });

  it("refuses the manager half before the self half exists", async () => {
    const result = await call(managerReview, `/api/v1/performance/reviews/${reviewId}/manager`, {
      as: t.acme.manager,
      method: "POST",
      params: { id: reviewId },
      body: { rating: 4, comments: "Too early." },
    });

    expect(result.status).toBe(422);
    expect(result.error?.message).toMatch(/self review/i);
  });

  it("refuses a rating off the scale", async () => {
    const result = await call(selfReview, `/api/v1/performance/reviews/${reviewId}/self`, {
      as: t.acme.employee,
      method: "POST",
      params: { id: reviewId },
      body: { rating: 9, comments: "Off the scale." },
    });

    expect(result.status).toBe(400);
  });

  it("takes the employee's half", async () => {
    const result = await call<{ status: string }>(
      selfReview,
      `/api/v1/performance/reviews/${reviewId}/self`,
      {
        as: t.acme.employee,
        method: "POST",
        params: { id: reviewId },
        body: { rating: 4, comments: "A good half year." },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("pending_manager");
  });

  it("will not take it twice", async () => {
    const result = await call(selfReview, `/api/v1/performance/reviews/${reviewId}/self`, {
      as: t.acme.employee,
      method: "POST",
      params: { id: reviewId },
      body: { rating: 5, comments: "Actually, five." },
    });

    expect(result.status).toBe(422);
  });

  it("takes the manager's half, and seeds the final rating from it", async () => {
    const result = await call<{ status: string; managerRating: number; finalRating: number }>(
      managerReview,
      `/api/v1/performance/reviews/${reviewId}/manager`,
      {
        as: t.acme.manager,
        method: "POST",
        params: { id: reviewId },
        body: { rating: 3, comments: "Solid, with more to come." },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("completed");
    expect(result.data.managerRating).toBe(3);
    // A starting point for calibration, not the last word.
    expect(result.data.finalRating).toBe(3);
  });

  it("lets HR settle a different final rating", async () => {
    const result = await call<{ finalRating: number }>(
      finalRating,
      `/api/v1/performance/reviews/${reviewId}/final`,
      {
        as: t.acme.hr,
        method: "POST",
        params: { id: reviewId },
        body: { finalRating: 4 },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.finalRating).toBe(4);
  });

  it("sends one back, clearing the half being rewritten", async () => {
    const result = await call<{ status: string; managerRating: number | null }>(
      reopenReview,
      `/api/v1/performance/reviews/${reviewId}/reopen`,
      {
        as: t.acme.hr,
        method: "POST",
        params: { id: reviewId },
        body: { to: "pending_manager" },
      },
    );

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.status).toBe("pending_manager");
    // Cleared, so a stale rating cannot sit under a status saying it is unwritten.
    expect(result.data.managerRating).toBeNull();
  });
});

describe("what each person sees", () => {
  it("shows an employee only reviews about themselves", async () => {
    const result = await call<{ employeeId: string }[]>(
      listReviews,
      "/api/v1/performance/reviews",
      { as: t.acme.employee },
    );

    expect(result.status).toBe(200);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.employeeId === t.acme.employee.employeeId)).toBe(true);
  });

  it("shows a manager the ones they have to write", async () => {
    const result = await call<{ managerId: string | null }[]>(
      listReviews,
      "/api/v1/performance/reviews",
      { as: t.acme.manager, query: { toWrite: "true" } },
    );

    expect(result.status).toBe(200);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.managerId === t.acme.manager.employeeId)).toBe(true);
  });

  it("refuses the whole-cycle summary to an employee", async () => {
    const result = await call(cycleSummary, `/api/v1/performance/cycles/${cycleId}/summary`, {
      as: t.acme.employee,
      params: { id: cycleId },
    });

    expect(result.status).toBe(403);
  });

  it("gives HR the shape of the ratings, not just the average", async () => {
    const result = await call<{
      tally: { total: number; completed: number; distribution: Record<string, number> };
    }>(cycleSummary, `/api/v1/performance/cycles/${cycleId}/summary`, {
      as: t.acme.hr,
      params: { id: cycleId },
    });

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.tally.total).toBeGreaterThan(0);
    expect(Object.keys(result.data.tally.distribution)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
