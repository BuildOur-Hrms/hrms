/**
 * Test environment defaults.
 *
 * Set before any module reads `process.env`, so `src/lib/env.ts` validates
 * successfully in suites that never touch a database. Vitest already sets
 * NODE_ENV=test; the cast is only needed because Node types it as readonly.
 */
const env = process.env as Record<string, string | undefined>;

env["NODE_ENV"] = "test";
env["AUTH_SECRET"] ??= "test-secret-that-is-long-enough-for-validation";
env["DATABASE_URL"] ??= "postgresql://test:test@localhost:5432/test";
env["APP_URL"] ??= "http://localhost:3000";
env["EMAIL_PROVIDER"] ??= "console";
env["LOG_LEVEL"] ??= "silent";
