import { expect, test } from "@playwright/test";

import { STATE, futureWorkingDay, runOffset } from "./fixtures";

/**
 * Apply for leave, then have it approved — the round trip that touches the
 * day count, the balance, the approval queue and two different people's
 * screens.
 *
 * The date moves with the run, because leave requests may not overlap and a
 * fixed date works exactly once.
 */

/**
 * A different day per project.
 *
 * Desktop and mobile run the same journey against the same database, and a
 * request the desktop project already approved is not waiting for the mobile
 * one. The project name shifts the date so the two never reach for the same
 * row.
 */
function leaveDay(project: string): string {
  return futureWorkingDay((runOffset() % 30) + (project === "mobile" ? 45 : 0));
}

test.describe.configure({ mode: "serial" });

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("applies for a day", async ({ page }) => {
    await page.goto("/me/leave");

    await page.getByRole("button", { name: "Apply for leave" }).click();
    await expect(page.getByRole("heading", { name: "Apply for leave" })).toBeVisible();

    // `exact` throughout: the shell has a "Toggle theme" button, and a
    // substring match on "To" finds it before it finds the date field.
    await page.getByLabel("Type", { exact: true }).click();
    await page.getByRole("option", { name: /Casual leave/ }).click();

    const day = leaveDay(test.info().project.name);
    await page.getByLabel("From", { exact: true }).fill(day);
    await page.getByLabel("To", { exact: true }).fill(day);
    await page.getByLabel("Reason", { exact: true }).fill("End to end test request");

    // The quote has to arrive before the button enables: the form refuses to
    // submit a request it cannot price.
    const submit = page.getByRole("button", { name: "Submit request" });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText(day).first()).toBeVisible();
  });

  test("cannot reach the approval queue", async ({ page }) => {
    await page.goto("/team/leave-approvals");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();
  });
});

test.describe("the manager", () => {
  test.use({ storageState: STATE.manager });

  test("sees it waiting and approves it", async ({ page }) => {
    await page.goto("/team/leave-approvals");

    const row = page.locator("li").filter({ hasText: leaveDay(test.info().project.name) });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();

    await expect(row).toHaveCount(0);
  });
});

test.describe("the employee again", () => {
  test.use({ storageState: STATE.employee });

  test("sees the decision", async ({ page }) => {
    await page.goto("/me/leave");

    const row = page.locator("li").filter({ hasText: leaveDay(test.info().project.name) });
    await expect(row.getByText(/approved/i).first()).toBeVisible();
  });
});
