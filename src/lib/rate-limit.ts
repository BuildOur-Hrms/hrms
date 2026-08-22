import { RateLimitError } from "./errors";
import { env } from "./env";

/**
 * Fixed-window rate limiting.
 *
 * The in-process store below is correct for a single web instance, which is
 * what the pilot runs. Once the app is horizontally scaled the same interface
 * is backed by Redis INCR + EXPIRE — the call sites do not change.
 *
 * Buckets follow docs/09-security.md §8.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export const RATE_LIMITS = {
  /** Brute-force guard. Complements per-account lockout, which is the real defence. */
  login: { limit: 10, windowSeconds: 60 },
  /** Enumeration + mail-bomb guard. */
  forgotPassword: { limit: 5, windowSeconds: 900 },
  resetPassword: { limit: 10, windowSeconds: 900 },
  /** Blanket ceiling for authenticated mutations. */
  mutation: { limit: 120, windowSeconds: 60 },
  /** Expensive endpoints: exports, report generation. */
  expensive: { limit: 10, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Counter {
  count: number;
  resetAt: number;
}

const counters = new Map<string, Counter>();
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }
}

export async function checkRateLimit(
  bucket: RateLimitBucket,
  identifier: string,
): Promise<RateLimitResult> {
  // Limits would make integration tests order-dependent and flaky.
  if (env.NODE_ENV === "test") {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds: 0 };
  }

  const rule = RATE_LIMITS[bucket];
  const now = Date.now();
  sweep(now);

  const key = `${bucket}:${identifier}`;
  const existing = counters.get(key);

  if (!existing || existing.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);

  if (existing.count > rule.limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: rule.limit - existing.count, retryAfterSeconds };
}

/** Throws 429 when the bucket is exhausted. */
export async function enforceRateLimit(bucket: RateLimitBucket, identifier: string): Promise<void> {
  const result = await checkRateLimit(bucket, identifier);
  if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds);
}

/** Test-only helper so suites can start from a clean slate. */
export function __resetRateLimits(): void {
  counters.clear();
}
