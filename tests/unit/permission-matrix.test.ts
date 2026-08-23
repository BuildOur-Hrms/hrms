import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PERMISSION_CODES, ROLE_PERMISSIONS, SYSTEM_ROLES } from "@/lib/permissions";
import {
  SESSION_ONLY_REASONS,
  UNAUTHENTICATED,
  allows,
  endpointKey,
  renderMatrix,
  scanRoutes,
} from "../../scripts/permission-matrix";

/**
 * Every endpoint crossed with the four system roles
 * (docs/10-roadmap-testing-deployment.md §3).
 *
 * Generated from the routes, not written down: the grid is derived from the
 * permission each route actually declares and the role matrix in
 * `src/lib/permissions.ts`, so a drift between the two fails here rather than
 * shipping. A regression in this file is a data breach, not a bug.
 */

const routes = scanRoutes();

describe("route declarations", () => {
  it("finds the API surface", () => {
    // A scanner that silently matched nothing would make every assertion
    // below vacuously true, which is the failure mode worth guarding.
    expect(routes.length).toBeGreaterThan(50);
  });

  it("declares only permissions that exist in the catalog", () => {
    for (const route of routes) {
      if (route.kind !== "permission") continue;
      expect(PERMISSION_CODES).toContain(route.permission);
    }
  });

  it("gives a reason for every endpoint that asks only for a session", () => {
    const sessionOnly = routes.filter((r) => r.kind === "session").map(endpointKey);

    for (const key of sessionOnly) {
      // A route that reaches this list without a written reason is a route
      // where somebody forgot the permission — which must not be able to look
      // like a decision.
      expect(SESSION_ONLY_REASONS[key], `${key} has no documented reason`).toBeTruthy();
    }
  });

  it("keeps no stale entries in the reason list", () => {
    const sessionOnly = new Set(routes.filter((r) => r.kind === "session").map(endpointKey));
    for (const key of Object.keys(SESSION_ONLY_REASONS)) {
      expect(sessionOnly.has(key), `${key} no longer exists or is now permission-gated`).toBe(true);
    }
  });

  it("runs every handler outside the pipeline as a scheduler job or a named exception", () => {
    const open = routes.filter((r) => r.kind === "public").map(endpointKey);
    const declaredPublic = new Set([
      "POST /api/v1/auth/login",
      "POST /api/v1/auth/forgot-password",
      "POST /api/v1/auth/reset-password",
      "POST /api/v1/auth/accept-invite",
    ]);

    for (const key of open) {
      if (declaredPublic.has(key)) continue;
      expect(UNAUTHENTICATED[key], `${key} bypasses withApi without being declared`).toBeTruthy();
    }
  });

  it("authenticates every scheduled endpoint with the shared secret", () => {
    const scheduled = routes.filter((r) => r.path.includes("/cron/"));
    expect(scheduled.length).toBeGreaterThan(0);
    for (const route of scheduled) {
      expect(route.kind, `${endpointKey(route)} is not secret-authenticated`).toBe("cron");
    }
  });
});

describe("the grid", () => {
  const gated = routes.filter((r) => r.kind === "permission");

  it("lets the platform owner reach everything permission-gated", () => {
    for (const route of gated) {
      expect(allows(route, "super_admin"), endpointKey(route)).toBe(true);
    }
  });

  it("keeps an employee out of every company-wide and administrative endpoint", () => {
    const privileged = /\.(view_all|manage|approve|delete)$/;

    for (const route of gated) {
      if (!privileged.test(route.permission!)) continue;
      // `leave.approve` and friends are exactly the permissions self-service
      // must never carry: approving your own request is the oldest hole in
      // every HR system.
      expect(allows(route, "employee"), `${endpointKey(route)} (${route.permission})`).toBe(false);
    }
  });

  it("keeps a manager out of company-wide endpoints", () => {
    for (const route of gated) {
      if (!route.permission!.endsWith(".view_all")) continue;
      expect(allows(route, "manager"), `${endpointKey(route)} (${route.permission})`).toBe(false);
    }
  });

  it("widens reach strictly with each role", () => {
    const reach = (role: (typeof SYSTEM_ROLES)[number]) =>
      gated.filter((route) => allows(route, role)).length;

    expect(reach("employee")).toBeLessThan(reach("manager"));
    expect(reach("manager")).toBeLessThan(reach("hr_admin"));

    // Equal, not smaller, and correctly so: no endpoint gates on `platform.*`
    // yet, because company provisioning and cross-company reads arrive with
    // multi-tenant GA in Phase 3. Inside one company the two administrators
    // reach the same surface — what separates them is the permission neither
    // route nor role name can fake.
    expect(reach("hr_admin")).toBeLessThanOrEqual(reach("super_admin"));
    expect(ROLE_PERMISSIONS["hr_admin"]).not.toContain("platform.view_all");
    expect(ROLE_PERMISSIONS["hr_admin"]).not.toContain("platform.manage");
  });

  it("grants nothing an employee does not hold in the role matrix", () => {
    for (const route of gated) {
      const expected = ROLE_PERMISSIONS["employee"].includes(route.permission!);
      expect(allows(route, "employee")).toBe(expected);
    }
  });
});

describe("the committed matrix", () => {
  it("is current", () => {
    const committed = readFileSync(join(process.cwd(), "docs", "permission-matrix.md"), "utf8");
    // Regenerate with: npx tsx scripts/permission-matrix.ts
    expect(committed.replace(/\r\n/g, "\n")).toBe(renderMatrix(routes).replace(/\r\n/g, "\n"));
  });
});
