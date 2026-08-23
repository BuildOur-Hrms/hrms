import { timingSafeEqual } from "node:crypto";

import { TZDate } from "@date-fns/tz";
import { NextResponse } from "next/server";

import { bootstrap } from "@/lib/bootstrap";
import { adminDb, withTenant } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { recomputeDayForCompany } from "@/modules/attendance/service";

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

function authorized(request: Request): boolean {
  // No secret configured means the endpoint is closed, not open. A route that
  // rebuilds every employee's attendance must never default to public.
  if (!env.CRON_SECRET) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;

  // Compare over fixed-length digests so the check cannot be timed. Raw
  // timingSafeEqual throws on a length mismatch, which is itself a leak.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Yesterday, in the company's own timezone rather than the server's. */
function previousDay(timeZone: string): string {
  const nowThere = new TZDate(new Date(), timeZone);
  const yesterday = new Date(
    Date.UTC(nowThere.getFullYear(), nowThere.getMonth(), nowThere.getDate()) - 86_400_000,
  );
  return yesterday.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
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
