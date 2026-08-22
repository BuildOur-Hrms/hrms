import { NextResponse } from "next/server";

import { pingDatabase } from "@/lib/db";
import { queueHealth } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * `?ready=1` performs the dependency checks uptime monitoring should watch
 * (docs/05-architecture.md §9). The bare endpoint is a liveness probe: it must
 * stay cheap, because a load balancer restarting the process over a slow
 * database query is worse than the slow query.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!url.searchParams.has("ready")) {
    return NextResponse.json({ status: "ok" });
  }

  const [database, queue] = await Promise.all([pingDatabase(), queueHealth()]);
  const healthy = database && queue.healthy;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        database: database ? "ok" : "unreachable",
        queue: {
          driver: queue.driver,
          status: queue.healthy ? "ok" : "unreachable",
          depth: queue.depth,
        },
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
