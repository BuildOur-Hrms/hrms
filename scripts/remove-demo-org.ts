import "dotenv/config";

import { Client } from "pg";

/**
 * Removes the sample organisation that `SEED_DEMO=true` creates.
 *
 * The demo rows are indistinguishable from real ones once they are in the
 * table — same shape, same company — so this deletes by the exact
 * (code, name) pairs the seed writes rather than by anything looser. A
 * department someone genuinely created and happened to call ENG is not a
 * match unless its name is also "Engineering".
 *
 * Three things it refuses to do, because each one would destroy real data:
 *
 *   - Touch the baseline org (HQ / ADMIN / ADMIN). The seeded admin's own
 *     employee record points at it, so removing it orphans the account that
 *     is meant to be doing the cleanup.
 *   - Delete a row any employee still references. The UI blocks this too, and
 *     the FK would refuse anyway — but failing here names the employee rather
 *     than surfacing a constraint violation.
 *   - Delete anything at all without `--apply`. The default is a dry run,
 *     because the usual target of this script is production.
 *
 *   npm run db:remove-demo            # report what would go
 *   npm run db:remove-demo -- --apply # actually delete
 */

/** Exactly what prisma/seed.ts §8 writes. Kept in step with it by hand. */
const DEMO_DEPARTMENTS = [
  { code: "ENG", name: "Engineering" },
  { code: "HR", name: "Human Resources" },
  { code: "SALES", name: "Sales" },
  { code: "FIN", name: "Finance" },
];

const DEMO_DESIGNATIONS = [
  { code: "INTERN", title: "Intern" },
  { code: "ASSOC", title: "Associate" },
  { code: "SR_ASSOC", title: "Senior Associate" },
  { code: "LEAD", title: "Team Lead" },
  { code: "MGR", title: "Manager" },
  { code: "DIR", title: "Director" },
];

/** The baseline org from §6. Never a candidate, asserted rather than assumed. */
const PROTECTED_CODES = new Set(["ADMIN", "HQ"]);

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m  ${m}`);
const skip = (m: string) => console.log(`  \x1b[33m–\x1b[0m  ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗\x1b[0m  ${m}`);

interface Candidate {
  id: string;
  code: string;
  label: string;
  employees: number;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!url) throw new Error("Set DATABASE_URL (or DIRECT_DATABASE_URL) first.");

  const slug = process.env["SEED_COMPANY_SLUG"] ?? "acme";
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const company = await client.query<{ id: string; name: string }>(
      "select id, name from companies where slug = $1",
      [slug],
    );
    if (company.rowCount === 0) {
      throw new Error(`No company with slug "${slug}". Set SEED_COMPANY_SLUG to match.`);
    }
    const { id: companyId, name } = company.rows[0]!;

    console.log(`\n${apply ? "Removing" : "Dry run —"} demo org in ${name} (${slug})\n`);

    // A protected code appearing among the demo pairs would mean the two
    // lists have drifted apart, which is worth stopping for.
    for (const code of [...DEMO_DEPARTMENTS, ...DEMO_DESIGNATIONS].map((d) => d.code)) {
      if (PROTECTED_CODES.has(code)) {
        throw new Error(`Demo list contains protected code "${code}". Refusing to run.`);
      }
    }

    const departments = await client.query<Candidate>(
      `select d.id,
              d.code,
              d.name as label,
              (select count(*)::int from employees e where e.department_id = d.id) as employees
         from departments d
        where d.company_id = $1
          and (d.code, d.name) in (select * from unnest($2::text[], $3::text[]))`,
      [companyId, DEMO_DEPARTMENTS.map((d) => d.code), DEMO_DEPARTMENTS.map((d) => d.name)],
    );

    const designations = await client.query<Candidate>(
      `select d.id,
              d.code,
              d.title as label,
              (select count(*)::int from employees e where e.designation_id = d.id) as employees
         from designations d
        where d.company_id = $1
          and (d.code, d.title) in (select * from unnest($2::text[], $3::text[]))`,
      [companyId, DEMO_DESIGNATIONS.map((d) => d.code), DEMO_DESIGNATIONS.map((d) => d.title)],
    );

    const groups = [
      { table: "departments", rows: departments.rows },
      { table: "designations", rows: designations.rows },
    ];

    let blocked = 0;
    let removed = 0;

    for (const { table, rows } of groups) {
      if (rows.length === 0) {
        skip(`${table}: nothing matching the demo set — already clean`);
        continue;
      }

      for (const row of rows) {
        if (row.employees > 0) {
          blocked += 1;
          bad(`${table}: ${row.label} (${row.code}) — ${row.employees} employee(s) assigned, kept`);
          continue;
        }

        if (apply) {
          await client.query(`delete from ${table} where id = $1 and company_id = $2`, [
            row.id,
            companyId,
          ]);
          removed += 1;
          ok(`${table}: removed ${row.label} (${row.code})`);
        } else {
          removed += 1;
          ok(`${table}: would remove ${row.label} (${row.code})`);
        }
      }
    }

    console.log(
      `\n${apply ? "Removed" : "Would remove"} ${removed} row(s)` +
        `${blocked > 0 ? `, kept ${blocked} still in use` : ""}.`,
    );

    if (!apply && removed > 0) {
      console.log("\nRe-run with --apply to delete.\n");
    } else {
      console.log("");
    }

    // Rows in use are a real condition to act on, not a failure to hide.
    if (blocked > 0) process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("\nremove-demo-org failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
