import "dotenv/config";

import { randomBytes } from "node:crypto";

import { Client } from "pg";

/**
 * Create the database role the application connects as.
 *
 * docs/09-security.md §9 calls for `app_user`: no DDL, no `BYPASSRLS`, and
 * INSERT + SELECT only on `audit_logs`. It matters more than it looks. The
 * role that runs migrations owns every table, and an owner — or anything with
 * the `BYPASSRLS` attribute — ignores row-level security entirely. Connect the
 * app as that role and the second isolation layer is decorative: the policies
 * exist, `db:doctor` reports them enabled and forced, and they still let a
 * foreign-scoped session read every row.
 *
 * Run this once per database, as the owner:
 *
 *   npm run db:role
 *
 * Then point DATABASE_URL at the role it prints, leave DIRECT_DATABASE_URL as
 * the owner (migrations need DDL), and re-run `npm run db:doctor` — the
 * isolation probe should flip from FAIL to PASS.
 *
 * Re-running is safe: it resets the password and re-applies the grants.
 */

const ROLE = process.env["APP_DB_ROLE"] ?? "app_user";

if (!/^[a-z_][a-z0-9_]*$/.test(ROLE)) {
  throw new Error(`APP_DB_ROLE must be a plain identifier, got: ${ROLE}`);
}

/**
 * PostgreSQL does not accept bind parameters in DDL, so `CREATE ROLE ...
 * PASSWORD` needs a real literal. Double any quote in it, the way
 * `quote_literal` would.
 */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main() {
  const ownerUrl = process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!ownerUrl) throw new Error("Set DIRECT_DATABASE_URL to the owner connection first");

  const supplied = process.env["APP_DB_PASSWORD"];
  const password = supplied ?? randomBytes(24).toString("base64url");

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();

  try {
    const me = await client.query<{ user: string; db: string }>(
      "SELECT current_user AS user, current_database() AS db",
    );
    console.log(`\nConnected to ${me.rows[0]?.db} as ${me.rows[0]?.user}\n`);

    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE]);

    if (exists.rowCount === 0) {
      await client.query(
        `CREATE ROLE "${ROLE}" LOGIN PASSWORD ${sqlLiteral(password)} NOBYPASSRLS`,
      );
      console.log(`  created role ${ROLE}`);
    } else {
      await client.query(`ALTER ROLE "${ROLE}" LOGIN PASSWORD ${sqlLiteral(password)} NOBYPASSRLS`);
      console.log(`  role ${ROLE} already existed — password reset, BYPASSRLS cleared`);
    }

    // Read and write data; never change its shape.
    await client.query(`GRANT USAGE ON SCHEMA public TO "${ROLE}"`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${ROLE}"`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${ROLE}"`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "${ROLE}"`);

    // Tables created by future migrations, without needing to re-run this.
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${ROLE}"`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT USAGE, SELECT ON SEQUENCES TO "${ROLE}"`,
    );
    console.log("  granted data access on public schema (including future tables)");

    // Append-only, at the privilege level as well as by trigger. Two
    // independent mechanisms, because this is the record of who did what.
    await client.query(`REVOKE UPDATE, DELETE ON "audit_logs" FROM "${ROLE}"`);
    console.log("  revoked UPDATE and DELETE on audit_logs");

    const check = await client.query<{ bypass: boolean; superuser: boolean }>(
      "SELECT rolbypassrls AS bypass, rolsuper AS superuser FROM pg_roles WHERE rolname = $1",
      [ROLE],
    );
    const row = check.rows[0];
    if (row?.bypass || row?.superuser) {
      throw new Error(`${ROLE} still bypasses RLS — refusing to report success`);
    }
    console.log(`  verified ${ROLE} holds neither SUPERUSER nor BYPASSRLS`);

    const owner = new URL(ownerUrl);

    /**
     * Supabase routes through Supavisor, which reads the tenant from the
     * username: it is `postgres.<project-ref>`, not `postgres`. A custom role
     * has to follow the same convention, or the pooler cannot tell which
     * project the connection belongs to and refuses it.
     */
    const isPooler = owner.hostname.includes("pooler.supabase.com");
    const projectRef = owner.username.includes(".")
      ? owner.username.slice(owner.username.indexOf(".") + 1)
      : null;
    const appUsername = isPooler && projectRef ? `${ROLE}.${projectRef}` : ROLE;

    /**
     * When the password came from a secret, print a placeholder rather than
     * the value — and not merely for tidiness. A CI log redacts registered
     * secrets, so a *generated* password prints as `***` and the whole
     * connection string is unusable to the person who has to paste it. The
     * operator already knows a password they supplied.
     */
    const build = (port: string) => {
      const url = new URL(ownerUrl);
      url.username = appUsername;
      url.password = supplied ? "APP-DB-PASSWORD" : password;
      url.port = port;
      return url.toString().replace("APP-DB-PASSWORD", "<APP_DB_PASSWORD>");
    };

    console.log(`\nApplication role: ${appUsername}\n`);

    if (isPooler) {
      // 6543 is transaction mode, which is what the app wants: every query it
      // issues is already inside a transaction.
      console.log(`Vercel — DATABASE_URL (transaction pooler):\n`);
      console.log(`  ${build("6543")}\n`);
      console.log(`GitHub secret — SUPABASE_APP_DB_URL (session pooler, so the`);
      console.log(`doctor verifies the app's role rather than the owner's):\n`);
      console.log(`  ${build("5432")}\n`);
    } else {
      console.log(`  DATABASE_URL=${build(owner.port || "5432")}\n`);
    }

    console.log(`Leave SUPABASE_DB_URL as the owner (${owner.username}) — migrations need DDL.`);
    if (!supplied) {
      console.log(
        `\nNOTE: no APP_DB_PASSWORD was supplied, so one was generated. A CI log\n` +
          `redacts secrets, so the string above may render as *** and be unusable.\n` +
          `Set APP_DB_PASSWORD as a repository secret and re-run for a readable one.`,
      );
    }

    console.log(`\nThen re-run this workflow with "doctor" to confirm RLS is enforced.\n`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("\ncould not create the application role:", error);
  process.exit(1);
});
