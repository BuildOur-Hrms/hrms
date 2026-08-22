import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI config (migrations, generate, studio, seed).
 *
 * Migrations run over a DIRECT connection: pooled endpoints (Neon/pgBouncer)
 * cannot hold the advisory locks and session state `prisma migrate` needs.
 * The app itself uses the pooled `DATABASE_URL` — see src/lib/db.ts.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"],
  },
});
