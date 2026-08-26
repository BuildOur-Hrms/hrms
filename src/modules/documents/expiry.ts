import { fromDateOnly, toDateOnly } from "@/lib/utils";
import {
  notifyOnce,
  userIdsWithPermission,
  type DataContext,
  type NotifyInput,
} from "@/modules/notifications/service";

import { daysUntil, EXPIRY_NOTICE_DAYS, isNoticeDay } from "./rules";

/**
 * The nightly document run: warn, then lapse.
 *
 * Two jobs in one pass because they are one question asked of the same rows —
 * "what does today mean for this document" — and the answer to both is read
 * from the same short list of documents with a date anywhere near now.
 *
 * `today` is the company's own calendar date, resolved by the caller from the
 * company timezone. A run that used the server's date would lapse a passport
 * a day early for half the world, which for a compliance record is not a
 * rounding error.
 *
 * Safe to run twice: the notices are deduplicated against what is already in
 * the box for the day, and the status flip is idempotent by construction.
 */

export interface DocumentExpiryResult {
  date: string;
  notified: number;
  expired: number;
}

function warning(left: number, name: string): { title: string; body: string } {
  if (left === 0) {
    return { title: `${name} expires today`, body: `${name} expires today.` };
  }
  return {
    title: `${name} expires in ${left} day${left === 1 ? "" : "s"}`,
    body: `${name} expires on its recorded date, ${left} day${left === 1 ? "" : "s"} from now.`,
  };
}

export async function runDocumentExpiry(
  ctx: DataContext,
  today: string,
): Promise<DocumentExpiryResult> {
  const furthest = Math.max(...EXPIRY_NOTICE_DAYS);
  const horizon = fromDateOnly(today);
  horizon.setUTCDate(horizon.getUTCDate() + furthest);

  /*
   * Only what could possibly be due.
   *
   * The partial index on (status = 'active', expiry_date IS NOT NULL) serves
   * exactly this shape, which is why it was built.
   */
  const due = await ctx.db.document.findMany({
    where: { status: "active", expiryDate: { not: null, lte: horizon } },
    select: {
      id: true,
      name: true,
      expiryDate: true,
      employee: { select: { userId: true } },
    },
  });

  const hrUserIds = await userIdsWithPermission(ctx, "documents.view_all");

  const inputs: NotifyInput[] = [];
  for (const document of due) {
    if (!document.expiryDate) continue;
    const expiry = toDateOnly(document.expiryDate);
    if (!isNoticeDay(expiry, today)) continue;

    const { title, body } = warning(daysUntil(expiry, today), document.name);
    const link = `/me/documents`;

    // The person it belongs to, and the people who have to chase it. A
    // company document has no owner, so only the second half applies.
    const owner = document.employee?.userId;
    if (owner) inputs.push({ userId: owner, type: "document.expiring", title, body, link });
    for (const userId of hrUserIds) {
      if (userId === owner) continue;
      inputs.push({
        userId,
        type: "document.expiring",
        title,
        body,
        link: `/hr/documents`,
      });
    }
  }

  // Deduplicated against the same calendar day, so a retry after a partial
  // failure finishes the run rather than sending everything twice.
  const notified = await notifyOnce(ctx, fromDateOnly(today), inputs);

  const expired = await ctx.db.document.updateMany({
    where: { status: "active", expiryDate: { not: null, lt: fromDateOnly(today) } },
    data: { status: "expired" },
  });

  return { date: today, notified, expired: expired.count };
}
