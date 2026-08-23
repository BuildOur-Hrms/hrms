import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Shared-secret check for the scheduled-job endpoints.
 *
 * Extracted so every cron route authenticates identically — a second copy of
 * this is a second chance to get the fail-closed behaviour wrong.
 */
export function cronAuthorized(request: Request): boolean {
  // No secret configured means the endpoint is closed, not open. A route that
  // rewrites balances for every employee must never default to public.
  if (!env.CRON_SECRET) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;

  // Compare over equal-length buffers: the raw call throws on a length
  // mismatch, which is itself a leak.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
