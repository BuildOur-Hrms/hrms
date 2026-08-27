import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests (docs/10-roadmap-testing-deployment.md §3).
 *
 * Five journeys, each one a thing the pilot company does every day: sign in,
 * clock in, apply for leave and have it approved, raise a correction and have
 * it approved, lock a month. They run against a real server and a real
 * database, because the failures worth catching here — a form that posts the
 * wrong shape, a permission that hides a button somebody needs — do not show
 * up anywhere a mock is involved.
 *
 *   npm run db:seed-e2e     # accounts to sign in as
 *   npm run test:e2e
 *
 * Mobile is a project rather than a separate suite: the same journeys at
 * 375px, which is where the pilot's employees actually are.
 */

const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const BASE_URL = process.env["E2E_BASE_URL"] ?? `http://localhost:${PORT}`;

/**
 * Whether Playwright starts the app itself.
 *
 * `E2E_MANAGE_SERVER=0` points the run at a server that is already up, which
 * is what you want while iterating: a dev server that has already compiled
 * the routes turns a two-minute cold start into nothing. CI leaves it on and
 * gets a server of its own.
 */
const manageServer = process.env["E2E_MANAGE_SERVER"] !== "0";

export default defineConfig({
  testDir: "./tests/e2e",
  // These journeys write to shared rows — one month lock, one leave balance.
  // Running them in parallel would make them race each other rather than test
  // anything.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Generous: the first hit on a route in dev pays for compiling it.
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },

  projects: [
    // Signs in once per role and saves the cookies; everything else reuses
    // them. See tests/e2e/auth.setup.ts for why that is not just about speed.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      dependencies: ["setup"],
      /*
       * Two journeys run once, on desktop.
       *
       * `01-auth` would spend the login rate-limit budget re-proving
       * something that does not depend on the viewport. `09-profile-setup`
       * asserts a state that exists once per account — the setup prompt is
       * dismissed for good the first time — so a second project always finds
       * it already gone. `10-link-account` and `11-onboarding` are the same
       * shape: one unlinked pair, one arriving joiner, and neither is put
       * back by the second project arriving.
       */
      testIgnore:
        /(01-auth|09-profile-setup|10-link-account|11-onboarding|12-offboarding|13-performance|14-payroll)\.spec\.ts/,
    },
  ],

  ...(manageServer
    ? {
        webServer: {
          // A production build, not the dev server. Two reasons: the dev
          // server compiles routes on first hit, which turns the first
          // navigation of every journey into a timeout risk; and it is the
          // built app that ships, so it is the built app worth testing.
          //
          // Its own output directory, because two Next processes sharing
          // `.next` make both of them serve a half-written build.
          command: `npm run build && npm run start -- -p ${PORT}`,
          env: {
            NEXT_DIST_DIR: ".next-e2e",
            // PGlite serialises every query through one WASM thread and gives
            // up under a pool sized for a real server. Harmless against real
            // Postgres, and the difference between a suite that finishes
            // locally and one that does not.
            DB_POOL_MAX: process.env["DB_POOL_MAX"] ?? "2",
          },
          // `/login` rather than `/`, because the root redirects and a probe
          // that follows it proves the app renders rather than merely listens.
          url: `${BASE_URL}/login`,
          reuseExistingServer: true,
          timeout: 180_000,
          stdout: "ignore" as const,
          stderr: "pipe" as const,
        },
      }
    : {}),

  timeout: 90_000,
  expect: { timeout: 15_000 },
});
