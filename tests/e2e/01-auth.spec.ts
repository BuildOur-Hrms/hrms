import { expect, test } from "@playwright/test";

import { PASSWORD, STATE, USERS, signIn, signOut } from "./fixtures";

/**
 * Signing in is the journey every other one depends on, so it is checked from
 * both ends: the door opens for the right password and stays shut for the
 * wrong one.
 *
 * Real sign-ins are rationed here. Login allows ten attempts a minute per IP,
 * the setup project has already spent three, and a suite that burned the rest
 * proving the same thing four times would start failing on a control that is
 * working correctly. Everything that only needs *a* session uses a saved one.
 */

test("a wrong password is refused, without saying which half was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(USERS.employee);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/invalid|incorrect|could not/i).first()).toBeVisible();
  // Never "no such account": that turns the login form into a way to find out
  // who works here.
  await expect(page.getByText(/no such|unknown user|not found/i)).toHaveCount(0);
});

test("signing in opens the app, and signing out closes it again", async ({ page }) => {
  // `signIn` already waits for the shell, so reaching here is the assertion.
  await signIn(page, USERS.employee);
  await signOut(page);

  // Going back to a protected page must not resurrect the session.
  await page.goto("/me/leave");
  await expect(page).toHaveURL(/\/login/);
});

test("the password field is a password field", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
  expect(PASSWORD.length).toBeGreaterThan(11);
});

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("cannot reach the administration screens", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();
  });
});

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("can reach them", async ({ page }) => {
    await page.goto("/hr/employees");
    await expect(page.getByRole("heading", { name: /employees/i }).first()).toBeVisible();
  });
});
