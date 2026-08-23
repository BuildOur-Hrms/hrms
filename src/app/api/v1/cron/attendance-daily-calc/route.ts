import { TZDate } from "@date-fns/tz";
import { NextResponse } from "next/server";

import { bootstrap } from "@/lib/bootstrap";
import { adminDb, withTenant } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recomputeDayForCompany } from "@/modules/attendance/service";

import { cronAuthorized } from "../authorize";

export const runtime = "nodejs";
/** Rebuilds data; must never be served from a cache. */
export const dynamic = "force-dynamic";

/**
 * The nightly attendance rebuild, as an HTTP entry point.
 *
 * There is no worker process on Vercel, so the schedule lives in Vercel Cron
 * and this is what it calls. It deliberately does not go through `withApi`:
 * there is no session, no user and no tenant to resolve — the caller is the
 * platform itself, authenticated by a shared secret.
 */

/** Yesterday, in the company's own timezone rather than the server's. */
function previousDay(timeZone: string): string {
  const nowThere = new TZDate(new Date(), timeZone);
  const yesterday = new Date(
    Date.UTC(nowThere.getFullYear(), nowThere.getMonth(), nowThere.getDate()) - 86_400_000,
  );
  return yesterday.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    // Deliberately identical whether the secret is wrong or simply unset.
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  bootstrap();

  const companies = await adminDb.company.findMany({
    where: { status: "active", deletedAt: null },
    select: { id: true, timezone: true },
  });

  const results = [];
  for (const company of companies) {
    const workDate = previousDay(company.timezone);
    try {
      const result = await withTenant(company.id, (db) =>
        recomputeDayForCompany({ db, companyId: company.id }, workDate, (message, detail) =>
          logger.warn(detail, message),
        ),
      );
      results.push({ companyId: company.id, ...result });
    } catch (error) {
      // One tenant failing must not stop the rest of the platform's nightly run.
      logger.error(
        { companyId: company.id, workDate, err: error },
        "attendance daily calc failed for company",
      );
      results.push({ companyId: company.id, workDate, error: true });
    }
  }

  logger.info({ companies: results.length }, "attendance daily calc cron complete");
  return NextResponse.json({ ok: true, results });
}
