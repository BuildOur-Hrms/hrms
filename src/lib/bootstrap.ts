import { withTenant } from "./db";
import { mailer } from "./email";
import { globalSingleton } from "./global-store";
import { logger } from "./logger";
import { registerJobHandler } from "./queue";
import { registerAuditSubscriber } from "@/modules/audit/service";
import { recomputeDayForCompany } from "@/modules/attendance/service";

/**
 * One-time process wiring: event subscribers and job handlers.
 *
 * Called from `src/instrumentation.ts`, from `withApi` on every request, and
 * from the worker's entry point. It is idempotent and cheap, and calling it
 * from the request path is what guarantees the subscriptions exist in the
 * process actually handling the request — instrumentation alone is not enough,
 * because it is a separate bundle.
 */

export function bootstrap(): void {
  // Process-wide, so the registrations happen exactly once however many
  // bundles call this — and so that calling it from the request path is free.
  const state = globalSingleton("__hrms_bootstrap__", () => ({ done: false }));
  if (state.done) return;
  state.done = true;

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

  // The nightly rebuild. Registered here for the same reason `send-email` is:
  // with Redis the worker owns it, and without Redis the inline driver still
  // needs a handler or the job silently does nothing.
  registerJobHandler("attendance-daily-calc", async (payload, context) => {
    const result = await withTenant(payload.companyId, (db) =>
      recomputeDayForCompany(
        { db, companyId: payload.companyId },
        payload.workDate,
        (message, detail) => logger.warn({ ...detail, requestId: context.requestId }, message),
      ),
    );
    logger.info({ ...result, companyId: payload.companyId }, "attendance daily calc complete");
  });

  logger.info({ mailer: mailer.name }, "bootstrap complete");
}
