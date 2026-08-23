import { mkdirSync } from "node:fs";

import { test as setup } from "@playwright/test";

import { STATE, STATE_DIR, USERS, signIn } from "./fixtures";

/**
 * Sign in once per role and keep the cookie.
 *
 * Not just for speed. Login is rate limited to ten attempts a minute per IP,
 * and a suite that signed in at the top of every test would spend the second
 * half of its run being correctly refused by a safeguard that is doing its
 * job. Three sign-ins here, reused everywhere, leaves that budget for the
 * journeys that are actually about signing in.
 */

for (const role of ["hr", "manager", "employee"] as const) {
  setup(`sign in as ${role}`, async ({ page }) => {
    mkdirSync(STATE_DIR, { recursive: true });
    await signIn(page, USERS[role]);
    await page.context().storageState({ path: STATE[role] });
  });
}
