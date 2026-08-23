import { TZDate } from "@date-fns/tz";
import { NextResponse } from "next/server";

import { bootstrap } from "@/lib/bootstrap";
import { adminDb, withTenant } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runAccrual, runYearRollover } from "@/modules/leave/balances";
import { getSetting } from "@/modules/settings/service";

import { cronAuthorized } from "../authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Monthly leave accrual, and the year-end rollover when the month rolls over.
 *
 * One endpoint for both because they are the same event seen twice: crediting
 * January is exactly the moment December stops being able to earn anything,
 * so the rollover is safe to run then and never earlier.
 */
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
    const now = new TZDate(new Date(), company.timezone);
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    try {
      const accrual = await withTenant(company.id, async (db) => {
        const cutoff = await getSetting(db, company.id, "attendance.join_mid_month_cutoff_day");
        return runAccrual({ db, companyId: company.id }, year, month, cutoff, (m, d) =>
          logger.warn(d, m),
        );
      });

      // In January, last year can no longer earn anything, so what is left is
      // final and safe to carry.
      const rollover =
        month === 1
          ? await withTenant(company.id, (db) =>
              runYearRollover({ db, companyId: company.id }, year - 1, (m, d) => logger.warn(d, m)),
            )
          : null;

      results.push({ companyId: company.id, accrual, rollover });
    } catch (error) {
      // One tenant failing must not stop the rest of the platform's run.
      logger.error({ companyId: company.id, year, month, err: error }, "leave accrual failed");
      results.push({ companyId: company.id, error: true });
    }
  }

  logger.info({ companies: results.length }, "leave accrual cron complete");
  return NextResponse.json({ ok: true, results });
}
