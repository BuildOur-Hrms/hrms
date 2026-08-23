import "dotenv/config";

import type { RequestContext } from "../src/lib/context.ts";
import { withPlatform, withTenant, type TenantTx } from "../src/lib/db.ts";
import { logger } from "../src/lib/logger.ts";
import { PERMISSION_CODES, type PermissionCode } from "../src/lib/permissions.ts";
import { listDayForScope, getMonth } from "../src/modules/attendance/service.ts";
import { hrHome } from "../src/modules/dashboard/service.ts";
import { runReport } from "../src/modules/reports/service.ts";

/**
 * How long the heavy reads take on the standing 500-employee fixture
 * (docs/10-roadmap-testing-deployment.md §3).
 *
 *   npm run db:seed-load        # build the fixture
 *   npm run bench               # measure against it
 *
 * These are the screens that get slow first: they read a month of attendance
 * for everybody, and every one of them is on a path somebody opens on a Monday
 * morning at the same time as everybody else.
 *
 * A note on reading the numbers. Against PGlite — the zero-install local
 * database — queries are serialised through a single WASM thread, so absolute
 * timings are pessimistic and the useful signal is the *shape*: which reads
 * are an order of magnitude slower than their neighbours, and whether a change
 * moved one of them. Run it against staging Postgres for numbers to hold
 * anyone to.
 */

const RUNS = 5;
const BUDGET_MS = Number(process.env["BENCH_BUDGET_MS"] ?? 1_500);

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
}

function context(db: TenantTx, companyId: string, employeeId: string | null): RequestContext {
  return {
    userId: "00000000-0000-0000-0000-000000000000",
    companyId,
    employeeId,
    roles: ["super_admin"],
    permissions: new Set<PermissionCode>(PERMISSION_CODES),
    isSuperAdmin: false,
    requestId: "bench",
    ip: null,
    userAgent: null,
    db,
    log: logger,
  };
}

interface Measurement {
  name: string;
  p50: number;
  p95: number;
  rows: number;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index]!;
}

async function measure(
  name: string,
  companyId: string,
  employeeId: string | null,
  run: (ctx: RequestContext) => Promise<unknown>,
): Promise<Measurement> {
  const timings: number[] = [];
  let rows = 0;

  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    const result = await withTenant(companyId, (db) => run(context(db, companyId, employeeId)));
    timings.push(performance.now() - started);

    if (i === 0) {
      const data = result as { rows?: unknown[]; data?: unknown[] };
      rows = data?.rows?.length ?? data?.data?.length ?? 0;
    }
  }

  timings.sort((a, b) => a - b);
  return { name, p50: percentile(timings, 0.5), p95: percentile(timings, 0.95), rows };
}

async function main() {
  const slug = arg("company", "load-500");

  const company = await withPlatform((db) =>
    db.company.findFirst({ where: { slug }, select: { id: true, name: true } }),
  );
  if (!company) {
    throw new Error(`No company with slug "${slug}". Run \`npm run db:seed-load\` first.`);
  }

  const employee = await withTenant(company.id, (db) =>
    db.employee.findFirst({ where: { status: "active" }, select: { id: true } }),
  );

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const query = {
    page: 1,
    pageSize: 50,
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  };

  console.log(`\nBenchmarking ${company.name} (${slug}), ${RUNS} runs each\n`);

  const measurements: Measurement[] = [
    await measure("HR dashboard", company.id, employee?.id ?? null, (ctx) => hrHome(ctx)),
    await measure("Attendance — company day view", company.id, employee?.id ?? null, (ctx) =>
      listDayForScope(ctx, today, "all"),
    ),
    await measure("Attendance — one month, one person", company.id, employee?.id ?? null, (ctx) =>
      getMonth(ctx, employee!.id, query.year, query.month),
    ),
    await measure("Report R1 — headcount", company.id, employee?.id ?? null, (ctx) =>
      runReport(ctx, "headcount", { ...query, groupBy: "department" } as never),
    ),
    await measure("Report R2 — attendance summary", company.id, employee?.id ?? null, (ctx) =>
      runReport(ctx, "attendance-summary", query as never),
    ),
    await measure("Report R3 — absences", company.id, employee?.id ?? null, (ctx) =>
      runReport(ctx, "absences", query as never),
    ),
    await measure("Report R4 — late arrivals", company.id, employee?.id ?? null, (ctx) =>
      runReport(ctx, "late-arrivals", query as never),
    ),
    await measure("Report R6 — leave usage", company.id, employee?.id ?? null, (ctx) =>
      runReport(ctx, "leave-usage", query as never),
    ),
  ];

  const width = Math.max(...measurements.map((m) => m.name.length));
  let breached = 0;

  for (const m of measurements) {
    const over = m.p95 > BUDGET_MS;
    if (over) breached++;
    console.log(
      `  ${m.name.padEnd(width)}  p50 ${m.p50.toFixed(0).padStart(6)}ms   p95 ${m.p95
        .toFixed(0)
        .padStart(6)}ms   ${String(m.rows).padStart(4)} rows  ${over ? "OVER BUDGET" : ""}`,
    );
  }

  console.log(
    `\nBudget: p95 < ${BUDGET_MS}ms — ${breached === 0 ? "all within" : `${breached} over`}\n`,
  );
  if (breached > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
