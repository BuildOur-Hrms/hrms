import { mailer } from "./email";
import { logger } from "./logger";
import { registerJobHandler } from "./queue";
import { registerAuditSubscriber } from "@/modules/audit/service";

/**
 * One-time process wiring: event subscribers and job handlers.
 *
 * Called from `src/instrumentation.ts` on the web side and from the worker's
 * entry point, so both processes end up with the same subscriptions and
 * neither depends on some route happening to import the right module first.
 */

let done = false;

export function bootstrap(): void {
  if (done) return;
  done = true;

  registerAuditSubscriber();

  // With Redis configured the worker owns this job; the registration here is
  // what makes the inline fallback driver able to deliver mail in development.
  registerJobHandler("send-email", async (payload) => {
    await mailer.send({
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
  });

  logger.info({ mailer: mailer.name }, "bootstrap complete");
}
