import { beforeAll, describe, expect, it } from "vitest";

import { GET as listTypes, POST as createType } from "@/app/api/v1/leave-types/route";
import { DELETE as deleteType } from "@/app/api/v1/leave-types/[id]/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * The list the apply form is built from.
 *
 * Small, and worth having because the picker used to be built from balances,
 * so a type nobody had been allocated any of — unpaid leave, always — simply
 * did not appear.
 */

let t: Tenants;

beforeAll(async () => {
  t = await seedTenants();
});

describe("leave types", () => {
  it("are readable by an employee, who has to pick one to apply", async () => {
    const result = await call<{ id: string; name: string }[]>(listTypes, "/api/v1/leave-types", {
      as: t.acme.employee,
    });

    expect(result.status, result.error?.message).toBe(200);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("leave out ones that have been archived", async () => {
    /*
     * The archived type is one this test creates, rather than whatever
     * happens to be first in the list. Retiring the tenant's only leave type
     * would leave every assertion after this one comparing empty arrays,
     * which is a test that passes because there is nothing left to be wrong.
     */
    const created = await call<{ id: string }>(createType, "/api/v1/leave-types", {
      as: t.acme.hr,
      method: "POST",
      body: { code: "SABB", name: "Sabbatical", isPaid: false },
    });
    expect(created.status, created.error?.message).toBe(201);

    const before = await call<{ id: string }[]>(listTypes, "/api/v1/leave-types", {
      as: t.acme.employee,
    });
    expect(before.data.map((row) => row.id)).toContain(created.data.id);

    await withPlatform((db) =>
      db.leaveType.update({ where: { id: created.data.id }, data: { deletedAt: new Date() } }),
    );

    const after = await call<{ id: string }[]>(listTypes, "/api/v1/leave-types", {
      as: t.acme.employee,
    });

    expect(after.data.map((row) => row.id)).not.toContain(created.data.id);
    // The rest are still there — this is a filter, not an outage.
    expect(after.data.length).toBe(before.data.length - 1);
    expect(after.data.length).toBeGreaterThan(0);
  });

  it("let a retired code be used again", async () => {
    /*
     * Archiving sets `deleted_at`, and the duplicate check cannot see
     * archived rows. If the unique index still counted them, the second
     * create would fail on the raw constraint — a 409 naming a row no screen
     * in the app displays, with no way back through the UI.
     */
    const first = await call<{ id: string }>(createType, "/api/v1/leave-types", {
      as: t.acme.hr,
      method: "POST",
      body: { code: "SPCL", name: "Special leave", isPaid: true },
    });
    expect(first.status, first.error?.message).toBe(201);

    const removed = await call(deleteType, `/api/v1/leave-types/${first.data.id}`, {
      as: t.acme.hr,
      method: "DELETE",
      params: { id: first.data.id },
    });
    expect(removed.status, removed.error?.message).toBe(200);

    const again = await call<{ id: string }>(createType, "/api/v1/leave-types", {
      as: t.acme.hr,
      method: "POST",
      body: { code: "SPCL", name: "Special leave, take two", isPaid: true },
    });

    expect(again.status, again.error?.message).toBe(201);
    expect(again.data.id).not.toBe(first.data.id);
  });

  it("stay inside their own company", async () => {
    const ours = await call<{ id: string }[]>(listTypes, "/api/v1/leave-types", {
      as: t.acme.employee,
    });
    const theirs = await call<{ id: string }[]>(listTypes, "/api/v1/leave-types", {
      as: t.globex.employee,
    });

    // Both sides have to be non-empty, or the overlap below is empty for a
    // reason that has nothing to do with tenancy.
    expect(ours.data.length).toBeGreaterThan(0);
    expect(theirs.data.length).toBeGreaterThan(0);

    const overlap = ours.data
      .map((row) => row.id)
      .filter((id) => theirs.data.some((row) => row.id === id));
    expect(overlap).toEqual([]);
  });
});
