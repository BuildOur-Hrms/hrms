import { beforeEach, describe, expect, it } from "vitest";

import type { MailMessage } from "@/lib/email";
import { queueEmail, withOutbox } from "@/lib/outbox";
import { registerJobHandler } from "@/lib/queue";
import { emailsFor } from "@/modules/notifications/channels";
import type { NotifyInput } from "@/modules/notifications/service";

/**
 * The outbox exists for one reason: an email cannot be un-sent, so it must not
 * leave before the transaction that earned it has committed. These tests pin
 * both halves of that — held while the work runs, dropped if the work fails.
 */

const sent: MailMessage[] = [];

registerJobHandler("send-email", async (payload) => {
  sent.push(payload);
});

/** The inline queue driver runs handlers detached; let them land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const message = (to: string): MailMessage => ({
  to,
  subject: "Subject",
  html: "<p>Body</p>",
  text: "Body",
});

beforeEach(() => {
  sent.length = 0;
});

describe("withOutbox", () => {
  it("holds mail until the work finishes, then sends it in order", async () => {
    await withOutbox(async () => {
      queueEmail(message("first@example.com"));
      queueEmail(message("second@example.com"));
      await settle();
      // Still inside the transaction: nothing may have left yet.
      expect(sent).toEqual([]);
    });
    await settle();

    expect(sent.map((m) => m.to)).toEqual(["first@example.com", "second@example.com"]);
  });

  it("sends nothing when the work throws", async () => {
    await expect(
      withOutbox(async () => {
        queueEmail(message("rolled-back@example.com"));
        throw new Error("constraint violation");
      }),
    ).rejects.toThrow("constraint violation");
    await settle();

    expect(sent).toEqual([]);
  });

  it("sends immediately outside a buffer, where there is no transaction to wait for", async () => {
    queueEmail(message("worker@example.com"));
    await settle();

    expect(sent.map((m) => m.to)).toEqual(["worker@example.com"]);
  });

  it("does not leak a buffer between two runs", async () => {
    await withOutbox(async () => queueEmail(message("one@example.com")));
    await withOutbox(async () => queueEmail(message("two@example.com")));
    await settle();

    expect(sent.map((m) => m.to)).toEqual(["one@example.com", "two@example.com"]);
  });
});

describe("email channel map", () => {
  const notice = (type: string): NotifyInput => ({
    userId: "user-1",
    type,
    title: "t",
    body: "b",
  });

  it("emails the notices that ask the recipient to act", () => {
    const types = emailsFor(
      [
        "leave.requested",
        "leave.reviewed",
        "attendance.correction_requested",
        "attendance.correction_reviewed",
        "attendance.absent_no_leave",
        "probation.ending",
      ].map(notice),
    ).map((n) => n.type);

    expect(types).toHaveLength(6);
  });

  it("leaves the ambient ones in-app only", () => {
    const types = ["birthday", "work_anniversary", "holiday.upcoming", "attendance.late"];
    expect(emailsFor(types.map(notice))).toEqual([]);
  });
});
