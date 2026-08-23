import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * HR entering a day for somebody who could not.
 *
 * The last assertion is the one worth having: the grid must show the entered
 * status where it previously showed nothing. A dialog that saves and leaves
 * the screen unchanged is indistinguishable from one that does not save.
 */

/** A weekday in the recent past — after the fixture's join date, before today. */
function recentWeekday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 10);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

const DAY = recentWeekday();

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("enters a day by hand and sees it on the grid", async ({ page }) => {
    await page.goto("/hr/attendance");

    await page.getByLabel("Day", { exact: true }).fill(DAY);

    const row = page.locator("tr").filter({ hasText: "Eli" });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(DAY) })).toBeVisible();

    await page.getByLabel("Or set the day to").click();
    await page.getByRole("option", { name: "On leave" }).click();
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Agreed before the system went in; no punches exist.");

    await page.getByRole("button", { name: "Save the day" }).click();

    await expect(row.getByText("On leave")).toBeVisible();
  });
});

test.describe("a manager", () => {
  test.use({ storageState: STATE.manager });

  test("is not offered the action", async ({ page }) => {
    await page.goto("/team/attendance");

    await expect(page.getByRole("heading", { name: /team attendance/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter" })).toHaveCount(0);
  });
});
