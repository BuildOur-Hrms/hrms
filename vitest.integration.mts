import { defineConfig } from "vitest/config";

/**
 * The integration suite: real Postgres, RLS active, routes called through the
 * whole `withApi` pipeline.
 *
 * Separate from the unit config because these tests need a database that the
 * lint-and-unit job does not have, and because they must run in one process,
 * in order: they share two seeded tenants and truncate between files would
 * cost more than it buys.
 *
 *   npx vitest run --config vitest.integration.mts
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // One database, one connection pool. Parallel files against PGlite (which
    // serialises anyway) buy nothing and make failures interleave.
    fileParallelism: false,
    sequence: { concurrent: false },
    // The suite is sequential, so a large pool buys nothing — and PGlite,
    // the zero-install local database, gives up entirely under one sized for
    // a real server.
    env: { DB_POOL_MAX: process.env["DB_POOL_MAX"] ?? "2" },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
