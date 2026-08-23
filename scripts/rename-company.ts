import "dotenv/config";

import { Client } from "pg";

/**
 * Renames the seeded company, slug included.
 *
 * This exists because the slug is the seed's upsert key
 * (`where: { slug: SEED_COMPANY_SLUG }`), which makes changing it a two-sided
 * operation: the database row and the configured value have to move together.
 * Change only the config and the next seed creates a second company. Change
 * only the row and the next seed creates one under the old slug. Either way
 * you end up with two tenants and no error to tell you.
 *
 * So the target is read from the same variables the seed reads — set those
 * first, then run this to bring the row to match. Afterwards the seed is
 * idempotent again: it finds the row by its new slug and rewrites the name it
 * already has.
 *
 *   FROM_SLUG=acme npm run db:rename-company            # report the change
 *   FROM_SLUG=acme npm run db:rename-company -- --apply # commit it
 */

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m  ${m}`);
const info = (m: string) => console.log(`     ${m}`);

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!url) throw new Error("Set DATABASE_URL (or DIRECT_DATABASE_URL) first.");

  const fromSlug = process.env["FROM_SLUG"];
  if (!fromSlug) throw new Error("Set FROM_SLUG to the company's current slug.");

  const toName = process.env["SEED_COMPANY_NAME"];
  const toSlug = process.env["SEED_COMPANY_SLUG"];
  if (!toName || !toSlug) {
    throw new Error(
      "Set SEED_COMPANY_NAME and SEED_COMPANY_SLUG to the target values first — " +
        "this script deliberately reads the same variables the seed does, so the " +
        "two cannot drift apart.",
    );
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const current = await client.query<{ id: string; name: string; slug: string }>(
      "select id, name, slug from companies where slug = $1",
      [fromSlug],
    );
    if (current.rowCount === 0) {
      throw new Error(`No company with slug "${fromSlug}".`);
    }
    const company = current.rows[0]!;

    // The slug is unique, so a collision would fail on the UPDATE anyway —
    // but a second company already sitting on the target slug is a situation
    // worth naming rather than surfacing as a constraint violation.
    if (toSlug !== fromSlug) {
      const clash = await client.query("select id from companies where slug = $1", [toSlug]);
      if (clash.rowCount && clash.rowCount > 0) {
        throw new Error(
          `A different company already uses slug "${toSlug}". ` +
            `Renaming into it would merge two tenants in name only. Refusing.`,
        );
      }
    }

    console.log(`\n${apply ? "Renaming" : "Dry run — would rename"}:\n`);
    info(`name  ${company.name}  →  ${toName}`);
    info(`slug  ${company.slug}  →  ${toSlug}`);
    console.log("");

    if (company.name === toName && company.slug === toSlug) {
      ok("Already matches the configured values — nothing to do.\n");
      return;
    }

    if (apply) {
      await client.query("update companies set name = $1, slug = $2 where id = $3", [
        toName,
        toSlug,
        company.id,
      ]);
      ok(`Renamed. The seed now finds this row by slug "${toSlug}".\n`);
    } else {
      console.log("Re-run with --apply to commit.\n");
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("\nrename-company failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
