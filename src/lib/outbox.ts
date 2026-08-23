import { AsyncLocalStorage } from "node:async_hooks";

import type { MailMessage } from "./email";
import { logger } from "./logger";
import { enqueue } from "./queue";

/**
 * Emails that must not be sent until the work that earned them has committed.
 *
 * Notifications are written inside the emitting service's transaction, which
 * is what makes them atomic with the change they describe. An email is not:
 * once it is on the queue there is no taking it back, and "your leave was
 * approved" arriving for a request that then rolled back is worse than no
 * email at all.
 *
 * So the send is buffered for the life of the request and flushed after the
 * transaction closes. `withApi` opens the buffer; `queueEmail` fills it;
 * nothing leaves until the surrounding work has actually succeeded.
 *
 * Outside a buffer — a worker, a script — `queueEmail` sends immediately,
 * because there is no transaction to wait for.
 */

const storage = new AsyncLocalStorage<MailMessage[]>();

/** Run `fn`, then deliver whatever it queued. Nothing is sent if `fn` throws. */
export async function withOutbox<T>(fn: () => Promise<T>, requestId?: string): Promise<T> {
  const box: MailMessage[] = [];
  const result = await storage.run(box, fn);
  await flush(box, requestId);
  return result;
}

/** Queue an email for after the surrounding transaction commits. */
export function queueEmail(message: MailMessage): void {
  const box = storage.getStore();
  if (box) {
    box.push(message);
    return;
  }
  void deliver(message);
}

async function flush(box: MailMessage[], requestId?: string): Promise<void> {
  if (box.length === 0) return;
  // Sequential rather than parallel: a burst of mail is never urgent enough
  // to be worth opening a connection per recipient.
  for (const message of box) {
    await deliver(message, requestId);
  }
}

async function deliver(message: MailMessage, requestId?: string): Promise<void> {
  try {
    await enqueue(
      "send-email",
      {
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      { ...(requestId ? { requestId } : {}) },
    );
  } catch (error) {
    // An email is a courtesy. Failing to queue one must not fail the request
    // that already succeeded — the in-app notification is the record.
    logger.error({ err: error, to: message.to, requestId }, "could not queue notification email");
  }
}
