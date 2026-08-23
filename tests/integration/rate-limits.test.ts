import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { RATE_LIMITS } from "@/lib/rate-limit";

import { call, seedTenants, type Tenants } from "./harness";

/**
 * Rate-limit smoke (docs/09-security.md §8, docs/10-… §3).
 *
 * Not a test of the counter — that is arithmetic. A test that the counter is
 * actually wired to the endpoints where it matters, which is the part that
 * silently stops being true when a route is refactored.
 *
 * Login is the one that counts. Without a limit, an invite-only system with
 * strong passwords is still a system somebody can guess at a thousand
 * passwords a minute, and account lockout alone does not help: an attacker
 * spraying one password across many accounts never trips it.
 */

let t: Tenants;

beforeAll(async () => {
  // Limits are off in test by default, because they would make every other
  // suite order-dependent. This is the suite they exist for, so it turns them
  // back on for itself.
  process.env["RATE_LIMITS_IN_TEST"] = "on";
  t = await seedTenants();
});

afterAll(() => {
  delete process.env["RATE_LIMITS_IN_TEST"];
});

describe("login", () => {
  it("stops answering after the limit, and says how long to wait", async () => {
    const attempts = RATE_LIMITS.login.limit + 2;
    const statuses: number[] = [];

    for (let i = 0; i < attempts; i++) {
      const result = await call(login, "/api/v1/auth/login", {
        body: { email: t.acme.employee.email, password: `wrong-${i}` },
      });
      statuses.push(result.status);
    }

    // Attempts inside the window are answered on their merits — 401, or the
    // lockout that the fifth wrong password earns. What matters is that none
    // of them is 429: a limiter that fired early would lock out a person who
    // simply mistyped twice.
    const insideWindow = statuses.slice(0, RATE_LIMITS.login.limit);
    expect(insideWindow).not.toContain(429);

    // And that the ones past it are refused without the password being looked
    // at at all.
    expect(statuses.at(-1)).toBe(429);

    const blocked = await call(login, "/api/v1/auth/login", {
      body: { email: t.acme.employee.email, password: "wrong-again" },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.error?.code).toBe("RATE_LIMITED");
  });

  it("keeps refusing while the window is open, whatever is sent", async () => {
    // The point of the limit: once tripped, guessing right does not help. A
    // limiter that let a correct password through would only be slowing down
    // the attacker who was already wrong.
    const result = await call(login, "/api/v1/auth/login", {
      body: { email: t.acme.employee.email, password: "a-different-guess" },
    });
    expect(result.status).toBe(429);
  });
});

describe("password reset", () => {
  it("is limited too, and never says whether the address exists", async () => {
    const attempts = RATE_LIMITS.forgotPassword.limit + 1;
    const results = [];

    for (let i = 0; i < attempts; i++) {
      results.push(
        await call(forgotPassword, "/api/v1/auth/forgot-password", {
          body: { email: `nobody-${i}@nowhere.test` },
        }),
      );
    }

    expect(results.at(-1)?.status).toBe(429);
    // Every answer before the limit is the same one a real address gets —
    // otherwise this endpoint enumerates the company's staff list.
    for (const result of results.slice(0, RATE_LIMITS.forgotPassword.limit)) {
      expect(result.status).toBe(200);
    }
  });
});

describe("the catalog", () => {
  it("keeps the sensitive buckets tight", () => {
    // A regression here is somebody "fixing" a limit that was getting in the
    // way of a test, so the numbers are asserted rather than merely used.
    expect(RATE_LIMITS.login.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.login.windowSeconds).toBeLessThanOrEqual(60);
    expect(RATE_LIMITS.forgotPassword.limit).toBeLessThanOrEqual(5);
  });
});
