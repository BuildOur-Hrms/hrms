import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI config (migrations, generate, studio, seed).
 *
 * Migrations run over a DIRECT connection: pooled endpoints (Supabase's
 * transaction-mode Supavisor, pgBouncer) cannot hold the advisory locks and
 * session state `prisma migrate` needs. The app itself uses the pooled
 * `DATABASE_URL` — see src/lib/db.ts.
 *
 * The datasource is omitted entirely when neither URL is set, because
 * `prisma generate` runs during the Vercel build and needs no database. Only
 * the commands that actually connect should fail on a missing URL.
 */
const url = process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  ...(url ? { datasource: { url } } : {}),
});
