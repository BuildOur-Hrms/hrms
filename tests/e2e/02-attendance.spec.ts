import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * Clocking in and out — the thing every employee does before anything else,
 * and the one screen where a broken button stops the working day.
 *
 * The journey leaves the day as it found it: it reads the button, uses it,
 * and puts it back. One that only worked against a fresh database would be
 * one nobody ran twice.
 */

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("checks in and out again", async ({ page }) => {
    await page.goto("/me/attendance");

    const clock = page.getByRole("button", { name: /^Check (in|out)$/ });
    await expect(clock).toBeVisible();

    const startedCheckedIn = (await clock.textContent())?.includes("out") ?? false;

    await clock.click();
    await expect(clock).toHaveText(startedCheckedIn ? /Check in/ : /Check out/);

    // Back to where we started, so the next run reads the same board.
    await clock.click();
    await expect(clock).toHaveText(startedCheckedIn ? /Check out/ : /Check in/);
  });

  test("sees their own month and the corrections panel", async ({ page }) => {
    await page.goto("/me/attendance");

    await expect(page.getByRole("heading", { name: /attendance/i }).first()).toBeVisible();
    await expect(page.getByText(/corrections/i).first()).toBeVisible();
  });

  test("cannot open the company attendance view", async ({ page }) => {
    await page.goto("/hr/attendance");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();
  });
});

test.describe("a manager", () => {
  test.use({ storageState: STATE.manager });

  test("opens the team view", async ({ page }) => {
    await page.goto("/team/attendance");
    await expect(page.getByRole("heading", { name: /team attendance/i }).first()).toBeVisible();
  });
});
