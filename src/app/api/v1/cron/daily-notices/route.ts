import { TZDate } from "@date-fns/tz";
import { NextResponse } from "next/server";

import { bootstrap } from "@/lib/bootstrap";
import { adminDb, withTenant } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runDailyNotices } from "@/modules/notifications/daily";

import { cronAuthorized } from "../authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The morning notice run: birthdays, work anniversaries, probation endings
 * and tomorrow's holidays.
 *
 * Scheduled for 08:00 in the company timezone. The date is resolved per
 * company rather than from the server clock, because the whole point of these
 * notices is that they land on the right day where the people are.
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
      const result = await withTenant(company.id, (db) =>
        runDailyNotices({ db, companyId: company.id }, today),
      );
      results.push({ companyId: company.id, ...result });
    } catch (error) {
      // One tenant failing must not stop the rest of the platform's run.
      logger.error({ companyId: company.id, today, err: error }, "daily notices failed");
      results.push({ companyId: company.id, error: true });
    }
  }

  logger.info({ companies: results.length }, "daily notices cron complete");
  return NextResponse.json({ ok: true, results });
}
