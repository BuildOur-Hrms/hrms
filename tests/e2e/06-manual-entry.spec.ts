import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * HR entering a day for somebody who could not.
 *
 * The last assertion is the one worth having: the grid must show the entered
 * status where it previously showed nothing. A dialog that saves and leaves
 * the screen unchanged is indistinguishable from one that does not save.
 */

/**
 * The most recent weekday before today, and how many days back that is.
 *
 * Reached by clicking the grid's own "Previous day" control rather than by
 * filling the date input. Filling it sets the DOM value without React seeing
 * a change — the picker reads correctly, the grid stays on today, and the
 * dialog opens for the wrong day. That passed locally and failed in CI, which
 * is the wrong way round for a test to be wrong.
 */
function recentWeekday(): { day: string; back: number } {
  const date = new Date();
  let back = 0;
  do {
    date.setUTCDate(date.getUTCDate() - 1);
    back += 1;
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return { day: date.toISOString().slice(0, 10), back };
}

const { day: DAY, back: DAYS_BACK } = recentWeekday();

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("enters a day by hand and sees it on the grid", async ({ page }) => {
    await page.goto("/hr/attendance");

    for (let step = 0; step < DAYS_BACK; step += 1) {
      await page.getByLabel("Previous day").click();
    }
    // The grid is on that day, and the state the button changed is the same
    // state the Enter button reads.
    await expect(page.getByLabel("Day", { exact: true })).toHaveValue(DAY);

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
