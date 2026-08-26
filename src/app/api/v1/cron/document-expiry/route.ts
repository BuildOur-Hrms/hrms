import { TZDate } from "@date-fns/tz";
import { NextResponse } from "next/server";

import { bootstrap } from "@/lib/bootstrap";
import { adminDb, withTenant } from "@/lib/db";
import { logger } from "@/lib/logger";
import { withOutbox } from "@/lib/outbox";
import { runDocumentExpiry } from "@/modules/documents/expiry";

import { cronAuthorized } from "../authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The document expiry scan (docs/05-architecture.md §7).
 *
 * Warns at thirty days, seven days and on the day, then lapses anything whose
 * date has passed. Separate from the morning notice run because it answers a
 * different question — that one asks what today means for each person, this
 * one asks what it means for each document — and because a compliance record
 * that only ever changes when somebody happens to edit it is not a record.
 */

/**
 * Today's calendar date in a timezone, as `YYYY-MM-DD`.
 *
 * Built from the parts rather than serialised: `toISOString` on a zoned date
 * hands back UTC again, which is the bug this function exists to avoid.
 */
function companyDate(timezone: string): string {
  const now = new TZDate(new Date(), timezone);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  bootstrap();

  const companies = await adminDb.company.findMany({
    where: { status: "active", deletedAt: null },
    select: { id: true, timezone: true },
  });

  const results = [];
  for (const company of companies) {
    const today = companyDate(company.timezone);

    try {
      const result = await withOutbox(() =>
        withTenant(company.id, (db) => runDocumentExpiry({ db, companyId: company.id }, today)),
      );
      results.push({ companyId: company.id, ...result });
    } catch (error) {
      // One tenant failing must not stop the rest of the platform's run.
      logger.error({ companyId: company.id, today, err: error }, "document expiry failed");
      results.push({ companyId: company.id, error: true });
    }
  }

  logger.info({ companies: results.length }, "document expiry cron complete");
  return NextResponse.json({ ok: true, results });
}
