import { beforeAll, describe, expect, it } from "vitest";

import { GET as listTypes } from "@/app/api/v1/leave-types/route";
import { withPlatform } from "@/lib/db";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * The list the apply form is built from.
 *
 * Small, and worth having because both of these were wrong at once: an
 * employee could be offered a leave type HR had retired, and could not be
 * offered one nobody had given them a balance for.
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
     * Archiving sets `deleted_at`, and nothing was reading it — so a type
     * somebody had retired went on being offered to every employee in the
     * company, indefinitely.
     */
    const before = await call<{ id: string; name: string }[]>(listTypes, "/api/v1/leave-types", {
      as: t.acme.employee,
    });
    const victim = before.data[0]!;

    await withPlatform((db) =>
      db.leaveType.update({ where: { id: victim.id }, data: { deletedAt: new Date() } }),
    );

    const after = await call<{ id: string }[]>(listTypes, "/api/v1/leave-types", {
      as: t.acme.employee,
    });

    expect(after.data.map((row) => row.id)).not.toContain(victim.id);
    // The rest are still there — this is a filter, not an outage.
    expect(after.data.length).toBe(before.data.length - 1);
  });

  it("stay inside their own company", async () => {
    const ours = await call<{ id: string }[]>(listTypes, "/api/v1/leave-types", {
      as: t.acme.employee,
    });
    const theirs = await call<{ id: string }[]>(listTypes, "/api/v1/leave-types", {
      as: t.globex.employee,
    });

    const overlap = ours.data
      .map((row) => row.id)
      .filter((id) => theirs.data.some((row) => row.id === id));
    expect(overlap).toEqual([]);
  });
});
