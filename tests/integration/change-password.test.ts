import { beforeAll, describe, expect, it } from "vitest";

import { POST as changePassword } from "@/app/api/v1/auth/change-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { withPlatform } from "@/lib/db";

import { hashPassword } from "@/modules/auth/password";

import { call, callRaw, seedTenants, type Tenants } from "./harness";

/**
 * Changing your own password from inside the app.
 *
 * The interesting part is not that it works — it is what it refuses, and what
 * it does to the sessions somebody cannot see.
 */

const PATH = "/api/v1/auth/change-password";

/*
 * Passphrases this suite sets and then uses. Long and unguessable on purpose,
 * because the policy refuses anything that is not — which makes them look
 * exactly like a leaked credential to a secret scanner, hence the annotation.
 */
const FIRST = "Original-Harbour-Lantern-12"; // gitleaks:allow
const SECOND = "Marmalade-Cassette-41"; // gitleaks:allow
const THIRD = "Ferrous-Windmill-7788"; // gitleaks:allow

let t: Tenants;
let currentPassword = FIRST;
/** Re-issued by a successful change; the seeded one dies with the old version. */
let freshCookie = "";

beforeAll(async () => {
  t = await seedTenants();

  // The harness seeds a placeholder hash, because nothing else needs to know
  // a persona's password. This suite does, so it sets one it knows.
  const passwordHash = await hashPassword(currentPassword);
  await withPlatform((db) =>
    db.user.update({ where: { id: t.acme.employee.userId }, data: { passwordHash } }),
  );
});

describe("changing your own password", () => {
  it("refuses without the current one", async () => {
    const result = await call(changePassword, PATH, {
      as: t.acme.employee,
      method: "POST",
      body: { currentPassword: "not-the-right-password", newPassword: "Gr33nHouse-Lantern" },
    });

    // 400 with the problem on the field, which is what the form binds to.
    expect(result.status).toBe(400);
    expect(result.error?.message).toMatch(/current password/i);
  });

  it("refuses a new password that does not meet the policy", async () => {
    const result = await call(changePassword, PATH, {
      as: t.acme.employee,
      method: "POST",
      body: { currentPassword, newPassword: "password123" },
    });

    // 400, not 422: the shared password schema rejects this at the edge,
    // before the service is reached.
    expect(result.status).toBe(400);
  });

  it("refuses setting it to the one already in use", async () => {
    const result = await call(changePassword, PATH, {
      as: t.acme.employee,
      method: "POST",
      body: { currentPassword, newPassword: currentPassword },
    });

    expect(result.status).toBe(422);
  });

  it("changes it, and hands back a session that still works", async () => {
    const next = SECOND;

    const response = await callRaw(changePassword, PATH, {
      as: t.acme.employee,
      method: "POST",
      body: { currentPassword, newPassword: next },
    });

    expect(response.status).toBe(200);

    /*
     * A fresh cookie comes back on purpose. Every session is invalidated by
     * the version bump, so without re-issuing this one the person would be
     * signed out of the screen they just used to secure their account.
     */
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("hrms.session");
    freshCookie = setCookie!.split(";")[0]!;

    // And the old password no longer opens the door.
    const stale = await call(login, "/api/v1/auth/login", {
      method: "POST",
      body: { email: t.acme.employee.email, password: currentPassword },
    });
    expect(stale.status).toBe(401);

    const fresh = await call(login, "/api/v1/auth/login", {
      method: "POST",
      body: { email: t.acme.employee.email, password: next },
    });
    expect(fresh.status, fresh.error?.message).toBe(200);

    currentPassword = next;
  });

  it("leaves the sessions somebody could not see for dead", async () => {
    /*
     * The cookie minted before the change is exactly what a session on
     * another device is: issued against the old version, and never seen
     * again by the person changing the password. It has to stop working.
     */
    const staleCookie = t.acme.employee.cookie;

    const result = await call(changePassword, PATH, {
      as: { ...t.acme.employee, cookie: freshCookie },
      method: "POST",
      body: { currentPassword, newPassword: THIRD },
    });
    expect(result.status, result.error?.message).toBe(200);
    currentPassword = THIRD;

    const onTheOldSession = await call(changePassword, PATH, {
      as: { ...t.acme.employee, cookie: staleCookie },
      method: "POST",
      body: { currentPassword, newPassword: "Something-Else-Entirely-5" },
    });
    expect(onTheOldSession.status).toBe(401);
  });

  it("is not something an unauthenticated caller can do", async () => {
    const result = await call(changePassword, PATH, {
      method: "POST",
      body: { currentPassword, newPassword: "Another-Valid-Passphrase-9" },
    });

    expect(result.status).toBe(401);
  });
});
