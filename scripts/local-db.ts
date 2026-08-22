import { mkdirSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/**
 * A real PostgreSQL server on localhost with nothing to install.
 *
 * PGlite is PostgreSQL compiled to WebAssembly; `pglite-socket` puts it behind
 * a TCP socket speaking the actual wire protocol, so `pg`, Prisma Migrate and
 * everything else connect to it exactly as they would to a normal server. That
 * matters here: this project's isolation model depends on row-level security,
 * `SET LOCAL`, triggers and partial indexes, none of which survive a
 * SQLite-shaped stand-in.
 *
 *   npm run db:local          # leave running in its own terminal
 *   npm run db:deploy && npm run db:seed
 *
 * Data persists in `.local-db/` between runs. Delete that directory for a
 * clean slate.
 *
 * This is for development only. It is single-process and serialises queries,
 * so it is not a substitute for the Supabase instance in staging or
 * production — it is a way to work while that is being set up.
 */

const PORT = Number(process.env["LOCAL_DB_PORT"] ?? 5432);
const HOST = "127.0.0.1";
const DATA_DIR = process.env["LOCAL_DB_DIR"] ?? ".local-db";

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  console.log(`Starting PGlite in ${DATA_DIR}`);
  const db = await PGlite.create({ dataDir: DATA_DIR });

  const version = await db.query<{ version: string }>("SELECT version()");
  console.log(`  ${version.rows[0]?.version.split(",")[0]}`);

  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: HOST,
    // The server queues queries internally, so a client-side pool with more
    // than one connection is fine — they are just serialised.
    maxConnections: 20,
  });

  await server.start();

  const url = `postgresql://postgres:postgres@${HOST}:${PORT}/postgres`;
  console.log(`\nListening on ${HOST}:${PORT}\n`);
  console.log("Put both of these in .env:\n");
  console.log(`  DATABASE_URL=${url}`);
  console.log(`  DIRECT_DATABASE_URL=${url}\n`);
  console.log("Then: npm run db:deploy && npm run db:seed\n");
  console.log("Ctrl-C to stop.\n");

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nStopping…");
    await server.stop();
    await db.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error("local database failed to start:", error);
  process.exit(1);
});
