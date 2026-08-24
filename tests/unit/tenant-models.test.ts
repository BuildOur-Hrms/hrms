import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TENANT_MODELS } from "@/lib/db";

/**
 * Every table with a `company_id` must be registered for tenant scoping.
 *
 * This exists because of a bug it would have caught: five recruitment tables
 * and one task table shipped without being added to `TENANT_MODELS`, which
 * does not break anything visibly — the queries keep working, they simply
 * stop being scoped to a company. Row-level security is still underneath, so
 * production would have held; but layer 1 is the one that runs everywhere,
 * including against a superuser connection, and losing it silently is exactly
 * the failure this project has two layers to avoid.
 *
 * Read from the schema rather than from a second hand-written list, because a
 * hand-written list is the thing that went stale in the first place.
 */

/** Models declaring a `company_id` column, straight out of schema.prisma. */
function modelsWithCompanyId(): string[] {
  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const models: string[] = [];

  for (const block of schema.split(/^model /m).slice(1)) {
    const name = block.slice(0, block.indexOf(" ")).trim();
    const body = block.slice(0, block.indexOf("\n}"));
    if (/@map\("company_id"\)/.test(body)) models.push(name);
  }
  return models;
}

/**
 * `Company` is the tenant rather than a tenant row — the extension matches it
 * on its own primary key. `SystemSetting` is deliberately global-readable, so
 * a platform default with no company can be seen by everyone.
 */
const NOT_TENANT_SCOPED = new Set(["Company", "SystemSetting"]);

describe("tenant scoping", () => {
  const withCompanyId = modelsWithCompanyId();

  it("finds the tenant tables in the schema", () => {
    // A parser that matched nothing would make the assertion below vacuous.
    expect(withCompanyId.length).toBeGreaterThan(15);
    expect(withCompanyId).toContain("Employee");
  });

  it("registers every one of them", () => {
    const missing = withCompanyId
      .filter((model) => !NOT_TENANT_SCOPED.has(model))
      .filter((model) => !TENANT_MODELS.has(model));

    expect(missing, `add these to TENANT_MODELS in src/lib/db.ts: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("registers nothing that has no company to scope to", () => {
    const schemaModels = new Set(withCompanyId);
    const stale = [...TENANT_MODELS].filter((model) => !schemaModels.has(model));

    expect(stale, `these no longer carry company_id: ${stale.join(", ")}`).toEqual([]);
  });
});
