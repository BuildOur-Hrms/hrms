import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as createLeaveRequest } from "@/app/api/v1/leave/requests/route";
import { PUT as putSetting } from "@/app/api/v1/settings/[key]/route";
import { withPlatform } from "@/lib/db";
import type { MailMessage } from "@/lib/email";
import { registerJobHandler } from "@/lib/queue";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * The email channel, end to end: a notice that earns an email produces one,
 * and the company settings can stop it.
 *
 * Worth an integration test rather than a unit one because the interesting
 * part is the wiring — the notification is written inside the request's
 * transaction, the email is buffered until that commits, and the policy comes
 * from a settings row that a different endpoint writes. Each of those is fine
 * alone and the chain is what breaks.
 */

const sent: MailMessage[] = [];

/** The queue driver runs handlers detached; let them land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

let t: Tenants;
let day = 1;

/** A distinct weekday per request: leave may not overlap, and week-offs are refused. */
function nextWorkingDay(): string {
  const date = new Date(Date.UTC(2026, 9, 1));
  date.setUTCDate(date.getUTCDate() + day++);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
    day++;
  }
  return date.toISOString().slice(0, 10);
}

async function applyForLeave() {
  const date = nextWorkingDay();
  const result = await call(createLeaveRequest, "/api/v1/leave/requests", {
    as: t.acme.employee,
    body: {
      leaveTypeId: t.acme.leaveTypeId,
      startDate: date,
      endDate: date,
      reason: "Checking the email channel",
    },
  });
  expect(result.status, `${result.error?.code}: ${result.error?.message}`).toBe(201);
  await settle();
}

async function setSetting(key: string, value: unknown) {
  const result = await call(putSetting, `/api/v1/settings/${key}`, {
    as: t.acme.hr,
    method: "PUT",
    params: { key },
    body: { value },
  });
  expect(result.status, `${key}: ${result.error?.message}`).toBe(200);
}

beforeAll(async () => {
  t = await seedTenants();

  // After `seedTenants`, which calls `bootstrap()` — that registers the real
  // send-email handler, and the last registration for a job name wins.
  registerJobHandler("send-email", async (payload) => {
    sent.push(payload);
  });

  await withPlatform((db) =>
    db.leaveBalance.create({
      data: {
        companyId: t.acme.companyId,
        employeeId: t.acme.employee.employeeId,
        leaveTypeId: t.acme.leaveTypeId,
        year: 2026,
        opening: 40,
      },
    }),
  );
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await setSetting("notifications.email_enabled", true);
});

describe("by default", () => {
  it("emails the approver when leave is requested", async () => {
    await applyForLeave();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(t.acme.manager.email);
    expect(sent[0]?.subject).toMatch(/leave request/i);
    // The link has to be absolute: a relative path in an email goes nowhere.
    expect(sent[0]?.html).toContain("http");
  });
});

describe("when a company turns the channel off", () => {
  it("sends nothing, and still writes the notification", async () => {
    await setSetting("notifications.email_enabled", false);
    await applyForLeave();

    expect(sent).toEqual([]);

    const notifications = await withPlatform((db) =>
      db.notification.count({
        where: { companyId: t.acme.companyId, type: "leave.requested" },
      }),
    );
    // Two requests so far, two in-app notices. The switch is a channel, not a
    // mute: the record of what happened is not a preference.
    expect(notifications).toBe(2);
  });
});

describe("when a company narrows the event list", () => {
  it("stops emailing the events it removed", async () => {
    await setSetting("notifications.email_enabled", true);
    await setSetting("notifications.email_events", ["probation.ending"]);

    await applyForLeave();
    expect(sent).toEqual([]);
  });

  it("resumes when the event is put back", async () => {
    await setSetting("notifications.email_events", ["leave.requested"]);

    await applyForLeave();
    expect(sent).toHaveLength(1);
  });
});
