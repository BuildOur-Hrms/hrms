import { beforeAll, describe, expect, it } from "vitest";

import { GET as exportAudit } from "@/app/api/v1/audit-logs/export/route";
import { POST as createDepartment } from "@/app/api/v1/departments/route";
import { withPlatform } from "@/lib/db";

import { call, callRaw, seedTenants, type Persona, type Tenants } from "./harness";

/**
 * Exporting the audit trail.
 *
 * Three things worth proving, in order of how badly they would be missed: the
 * export is itself audited, it never crosses the tenant boundary, and it
 * cannot be used to smuggle a spreadsheet formula onto somebody's machine.
 */

let t: Tenants;

/** `call` unwraps a JSON envelope, and this endpoint answers in CSV. */
async function download(as: Persona, query: Record<string, string> = {}) {
  const response = await callRaw(exportAudit, "/api/v1/audit-logs/export", { as, query });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

beforeAll(async () => {
  t = await seedTenants();

  // Something to export, in both companies, with a name a spreadsheet would
  // try to evaluate if nobody stopped it.
  await call(createDepartment, "/api/v1/departments", {
    as: t.acme.hr,
    body: { name: "=SUM(1,2) Team", code: "FORMULA" },
  });
  await call(createDepartment, "/api/v1/departments", {
    as: t.globex.hr,
    body: { name: "Globex only", code: "GLOBEX" },
  });
});

describe("the download", () => {
  it("comes back as a CSV attachment with a header row", async () => {
    const result = await download(t.acme.hr);

    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toMatch(/text\/csv/);
    expect(result.headers.get("content-disposition")).toMatch(/attachment; filename="audit-log-/);
    expect(result.body.split("\r\n")[0]).toBe(
      "When,Actor,Actor name,Action,Entity,Entity id,IP,Changed fields",
    );
    expect(Number(result.headers.get("x-row-count"))).toBeGreaterThan(0);
  });

  it("is never cacheable", async () => {
    const result = await download(t.acme.hr);
    expect(result.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("honours the filters it was given", async () => {
    const all = await download(t.acme.hr);
    const departments = await download(t.acme.hr, { entityType: "department" });

    expect(departments.body.length).toBeLessThan(all.body.length);
    for (const line of departments.body.trim().split("\r\n").slice(1)) {
      expect(line).toContain("department");
    }
  });
});

describe("what it must not do", () => {
  it("does not carry another company's rows", async () => {
    const result = await download(t.acme.hr);
    expect(result.body).not.toContain("Globex only");
    expect(result.body).not.toContain(t.globex.hr.email);
  });

  it("refuses a manager", async () => {
    const result = await download(t.acme.manager);
    expect(result.status).toBe(403);
  });

  it("refuses an employee", async () => {
    const result = await download(t.acme.employee);
    expect(result.status).toBe(403);
  });

  it("does not put values in the file, only the names of what changed", async () => {
    const result = await download(t.acme.hr, { entityType: "department" });
    // The department was created with a formula for a name; the export records
    // that `name` changed, never what it changed to.
    expect(result.body).toContain("name");
    expect(result.body).not.toContain("SUM(1,2)");
  });
});

describe("the export itself", () => {
  it("is written to the trail it exported", async () => {
    await download(t.acme.hr, { action: "employee." });

    const row = await withPlatform((db) =>
      db.auditLog.findFirst({
        where: { companyId: t.acme.companyId, action: "audit.exported" },
        orderBy: { createdAt: "desc" },
        select: { actorUserId: true, after: true },
      }),
    );

    expect(row?.actorUserId).toBe(t.acme.hr.userId);
    // Including the filters, so "what did they take" is answerable later.
    expect(JSON.stringify(row?.after)).toContain("employee.");
  });

  it("cannot be deleted afterwards, like everything else in the trail", async () => {
    /*
     * Two defences, and which one answers depends on who is connected.
     *
     * The application role has no DELETE grant on `audit_logs` at all, so it
     * is stopped by permission (42501) before reaching the trigger. A
     * superuser gets past the grant and meets the append-only trigger
     * instead. Either refusal is the trail holding; asserting only the
     * trigger passed locally and failed in CI, which is the wrong way round
     * for a test of a security property.
     */
    await expect(
      withPlatform((db) =>
        db.$executeRawUnsafe(
          `DELETE FROM audit_logs WHERE company_id = '${t.acme.companyId}' AND action = 'audit.exported'`,
        ),
      ),
    ).rejects.toThrow(/append-only|permission denied/i);
  });
});
