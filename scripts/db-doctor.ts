import "dotenv/config";

import { Client } from "pg";

/**
 * Proves the database is configured the way the security model claims.
 *
 * The tenancy design in docs/04-database.md §4 rests on two independent
 * layers, and the second one — row-level security — is easy to have *look*
 * enabled while being completely inert:
 *
 *   - A role holding the BYPASSRLS attribute ignores every policy, including
 *     on tables marked FORCE ROW LEVEL SECURITY. Managed providers often grant
 *     it to the role they hand you.
 *   - A table with RLS enabled but not FORCE'd does not apply policies to its
 *     own owner, and the migrating role owns every table here.
 *
 * Either one silently reduces us to a single layer. This script asserts the
 * negative rather than assuming it: it points a session at a company id that
 * does not exist and requires the row count to be zero.
 *
 *   npm run db:doctor
 */

const TENANT_TABLES = [
  "companies",
  "locations",
  "departments",
  "designations",
  "system_settings",
  "users",
  "roles",
  "employees",
  "emergency_contacts",
  "audit_logs",
  "role_permissions",
  "user_roles",
  "password_reset_tokens",
  "permissions",
];

const ok = (message: string) => console.log(`  [32mPASS[0m  ${message}`);
const warn = (message: string) => console.log(`  [33mWARN[0m  ${message}`);
const fail = (message: string) => console.log(`  [31mFAIL[0m  ${message}`);
const info = (message: string) => console.log(`        ${message}`);

let failures = 0;
let warnings = 0;

function assert(condition: boolean, pass: string, failMessage: string) {
  if (condition) ok(pass);
  else {
    failures += 1;
    fail(failMessage);
  }
}

/**
 * A login role that policies actually constrain. Preferred over guessing at a
 * name: whatever it is called, what matters is that it is neither a superuser
 * nor holds BYPASSRLS.
 */
async function findRestrictedRole(client: Client): Promise<string | null> {
  const result = await client.query<{ rolname: string }>(`
    SELECT rolname FROM pg_roles
     WHERE rolcanlogin
       AND NOT rolsuper
       AND NOT rolbypassrls
       AND rolname NOT LIKE 'pg\_%'
     ORDER BY rolname
     LIMIT 1
  `);
  return result.rows[0]?.rolname ?? null;
}

/**
 * Count employees visible to a session scoped to a company id that owns
 * nothing. Everything is transaction-local and rolled back.
 */
async function probe(client: Client, asRole: string | null): Promise<number> {
  await client.query("BEGIN");
  try {
    if (asRole) await client.query(`SET LOCAL ROLE "${asRole}"`);
    await client.query(
      "SELECT set_config('app.company_id', '00000000-0000-0000-0000-000000000000', true)",
    );
    const scoped = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM employees",
    );
    return Number(scoped.rows[0]?.count ?? 0);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function main() {
  // DATABASE_URL first, on purpose: this checks the role the *application*
  // connects as. Verifying RLS over the owner connection proves nothing, since
  // the owner is exactly the role policies do not constrain.
  const url = process.env["DATABASE_URL"] ?? process.env["DIRECT_DATABASE_URL"];
  if (!url) throw new Error("Set DATABASE_URL first");

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // ── 1. who and where
    console.log("\nConnection\n");

    const identity = await client.query<{
      version: string;
      user: string;
      db: string;
      is_super: boolean;
      bypass_rls: boolean;
    }>(`
      SELECT current_setting('server_version') AS version,
             current_user                     AS user,
             current_database()                AS db,
             r.rolsuper                        AS is_super,
             r.rolbypassrls                    AS bypass_rls
        FROM pg_roles r
       WHERE r.rolname = current_user
    `);

    const me = identity.rows[0]!;
    info(`PostgreSQL ${me.version}`);
    info(`database ${me.db} as ${me.user}`);

    const major = Number.parseInt(me.version, 10);
    assert(
      major >= 14,
      `server version ${major} supports everything the schema uses`,
      `server version ${major} is older than the PostgreSQL 16 the schema targets`,
    );

    // ── 2. the attribute that would make RLS meaningless
    console.log("\nRow-level security\n");

    if (me.is_super || me.bypass_rls) {
      warnings += 1;
      warn(`${me.user} ${me.is_super ? "is a superuser" : "holds BYPASSRLS"}`);
      info("Policies are not enforced for this role, whatever the tables say.");
      info("Layer 1 (the Prisma tenant extension) is still active, but the");
      info("database-level backstop is not. Run the app as a role without");
      info("BYPASSRLS before this carries real employee data.");
    } else {
      ok(`${me.user} holds neither SUPERUSER nor BYPASSRLS`);
    }

    // ── 3. per-table RLS state
    const rls = await client.query<{
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>(
      `
      SELECT c.relname                             AS table,
             c.relrowsecurity                      AS enabled,
             c.relforcerowsecurity                 AS forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1)
       ORDER BY c.relname
      `,
      [TENANT_TABLES],
    );

    if (rls.rowCount === 0) {
      failures += 1;
      fail("none of the expected tables exist — run `npm run db:deploy` first");
      return;
    }

    const missing = TENANT_TABLES.filter((t) => !rls.rows.some((r) => r.table === t));
    assert(
      missing.length === 0,
      `all ${TENANT_TABLES.length} expected tables present`,
      `tables missing from the database: ${missing.join(", ")}`,
    );

    const notEnabled = rls.rows.filter((r) => !r.enabled).map((r) => r.table);
    assert(
      notEnabled.length === 0,
      "row-level security enabled on every tenant table",
      `RLS not enabled on: ${notEnabled.join(", ")}`,
    );

    const notForced = rls.rows.filter((r) => r.enabled && !r.forced).map((r) => r.table);
    assert(
      notForced.length === 0,
      "row-level security FORCE'd, so it applies to the table owner too",
      `RLS enabled but not FORCE'd on: ${notForced.join(", ")}`,
    );

    const noPolicy = rls.rows.filter((r) => r.policies === 0).map((r) => r.table);
    assert(
      noPolicy.length === 0,
      "every tenant table carries at least one policy",
      `RLS on with no policy (denies everything) on: ${noPolicy.join(", ")}`,
    );

    // ── 4. the helper functions the policies call
    const functions = await client.query<{ name: string }>(`
      SELECT p.proname AS name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('app_current_company', 'app_bypass_rls', 'audit_logs_append_only')
    `);
    const found = new Set(functions.rows.map((r) => r.name));
    for (const name of ["app_current_company", "app_bypass_rls", "audit_logs_append_only"]) {
      assert(found.has(name), `function ${name}() exists`, `function ${name}() is missing`);
    }

    // ── 5. the actual test: can this session see another tenant's rows?
    console.log("\nIsolation probe\n");

    const totalEmployees = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM employees",
    );
    const total = Number(totalEmployees.rows[0]?.count ?? 0);
    info(`${total} employee row${total === 1 ? "" : "s"} in the table`);

    if (total === 0) {
      warnings += 1;
      warn("no employee rows yet — the probe cannot prove isolation");
      info("Run `npm run db:seed` with SEED_DEMO=true, then re-run this.");
    } else {
      /**
       * Two questions that look identical when they fail, and are not:
       *
       *   1. Are the policies themselves correct? Answered by running the
       *      probe under a role that policies apply to.
       *   2. Is the role the app connects as actually subject to them?
       *
       * A deployment needs both. Reporting them separately is the difference
       * between "the SQL is wrong" and "the connection string is wrong".
       */
      const restricted = await findRestrictedRole(client);

      if (restricted) {
        const visible = await probe(client, restricted);
        assert(
          visible === 0,
          `policies are correct — scoped to a foreign company, ${restricted} sees zero of ${total} employees`,
          `under ${restricted}, a foreign-scoped session still saw ${visible} of ${total} employees — the policies themselves are wrong`,
        );
      } else {
        warnings += 1;
        warn("no non-privileged role found, so policy correctness is untested");
        info("Run `npm run db:role` to create one.");
      }

      const visibleAsConnected = await probe(client, null);
      if (me.is_super || me.bypass_rls) {
        // Already warned about above; do not double-count it as a failure.
        info(`as ${me.user}: sees ${visibleAsConnected} of ${total} (expected — it bypasses RLS)`);
      } else {
        assert(
          visibleAsConnected === 0,
          `the connected role (${me.user}) is subject to the policies`,
          `the connected role (${me.user}) saw ${visibleAsConnected} of ${total} employees`,
        );
      }
    }

    // ── 6. audit log immutability
    console.log("\nAudit log\n");

    const auditCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs",
    );
    if (Number(auditCount.rows[0]?.count ?? 0) === 0) {
      warnings += 1;
      warn("no audit rows yet — cannot test the append-only trigger");
    } else {
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
        await client.query("UPDATE audit_logs SET action = action WHERE true");
        failures += 1;
        fail("audit_logs accepted an UPDATE — the append-only trigger is not working");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        assert(
          message.includes("append-only"),
          "audit_logs rejects UPDATE at the database level",
          `audit_logs UPDATE failed, but not for the expected reason: ${message}`,
        );
      } finally {
        await client.query("ROLLBACK");
      }
    }

    // ── 7. constraints that are easy to lose in a migration edit
    console.log("\nConstraints\n");

    const indexes = await client.query<{ name: string }>(`
      SELECT indexname AS name FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN (
           'users_lower_email_key',
           'system_settings_global_key_key',
           'emergency_contacts_one_primary'
         )
    `);
    const indexNames = new Set(indexes.rows.map((r) => r.name));
    for (const name of [
      "users_lower_email_key",
      "system_settings_global_key_key",
      "emergency_contacts_one_primary",
    ]) {
      assert(indexNames.has(name), `index ${name} present`, `index ${name} is missing`);
    }
  } finally {
    await client.end();
  }

  console.log(
    `\n${failures === 0 ? "[32mAll checks passed[0m" : `[31m${failures} check(s) failed[0m`}` +
      `${warnings > 0 ? `, ${warnings} warning(s)` : ""}\n`,
  );

  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error("\ndb-doctor could not run:", error);
  process.exit(1);
});
