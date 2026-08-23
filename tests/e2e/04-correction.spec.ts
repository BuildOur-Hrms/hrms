import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * A missed punch, regularized: the employee asks for a day to be fixed and
 * the manager decides.
 *
 * Approving a correction does not edit history — it writes manual punches and
 * recomputes the day — so the thing worth proving here is that the request
 * reaches the right person and the decision sticks.
 */

/** Yesterday, which the form allows and the calculator has had a night to settle. */
function yesterday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const DAY = yesterday();
/** Project-scoped, so desktop and mobile do not race for the same request. */
function reasonFor(project: string): string {
  return `Badge reader was down on ${DAY} (${project})`;
}

test.describe.configure({ mode: "serial" });

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("raises a correction", async ({ page }) => {
    await page.goto("/me/attendance");

    await page.getByRole("button", { name: "Request a correction" }).click();
    await expect(page.getByRole("heading", { name: "Request a correction" })).toBeVisible();

    await page.getByLabel("Day", { exact: true }).fill(DAY);
    await page.getByLabel("Check-in", { exact: true }).fill("09:00");
    await page.getByLabel("Check-out", { exact: true }).fill("18:00");
    await page.getByLabel("Reason", { exact: true }).fill(reasonFor(test.info().project.name));

    await page.getByRole("button", { name: "Submit request" }).click();

    await expect(page.getByText(DAY).first()).toBeVisible();
  });
});

test.describe("the manager", () => {
  test.use({ storageState: STATE.manager });

  test("approves it", async ({ page }) => {
    await page.goto("/team/attendance");

    const row = page.locator("li").filter({ hasText: reasonFor(test.info().project.name) });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();

    await expect(row).toHaveCount(0);
  });
});
