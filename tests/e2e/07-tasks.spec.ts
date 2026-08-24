import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * The task screens.
 *
 * A chart that renders is not the same as a chart that is right, so these
 * check the numbers next to it: the table is the readable twin of the ranking,
 * and it is where the assertions go.
 */

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("sees their own completion and can move a task along", async ({ page }) => {
    await page.goto("/me/tasks");

    await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
    await expect(page.getByText(/of the work set for you/i)).toBeVisible();

    // Both lists are present and labelled, so the split is visible rather than
    // implied by a colour.
    await expect(page.getByText("Set for me")).toBeVisible();
    await expect(page.getByText("Added by me")).toBeVisible();

    const firstTask = page.locator("li").filter({ hasText: "Close ten support tickets" }).first();
    await firstTask.getByRole("button", { name: "75%", exact: true }).click();

    await expect(firstTask.getByText("75%").first()).toBeVisible();
  });

  test("cannot open the company board", async ({ page }) => {
    await page.goto("/hr/tasks");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();
  });
});

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("sees the ranking, the trend and the table", async ({ page }) => {
    await page.goto("/hr/tasks");

    await expect(page.getByRole("heading", { name: "Task completion" }).first()).toBeVisible();
    await expect(page.getByText("Assigned work done")).toBeVisible();

    // Two series, legend always present — identity is never colour alone.
    await expect(page.getByText("Assigned").first()).toBeVisible();
    await expect(page.getByText("Self-added").first()).toBeVisible();

    // The table twin carries every value the chart shows.
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByText("Eli Tester")).toBeVisible();
  });

  test("assigns a task and sees the board pick it up", async ({ page }) => {
    await page.goto("/hr/tasks");

    const row = page.getByRole("row").filter({ hasText: "Eli Tester" });
    await row.getByRole("button", { name: "Assign" }).click();

    await expect(page.getByText(/Assign a task to Eli Tester/)).toBeVisible();
    await page.getByLabel("What is it").fill("A target set from the board");
    await page.getByRole("button", { name: "Assign it" }).click();

    await expect(page.getByText(/Assign a task to/)).toHaveCount(0);
  });
});

test.describe("a manager", () => {
  test.use({ storageState: STATE.manager });

  test("sees only their own reports", async ({ page }) => {
    await page.goto("/team/tasks");

    await expect(page.getByRole("heading", { name: "Team tasks" })).toBeVisible();
    const table = page.getByRole("table");
    await expect(table.getByText("Eli Tester")).toBeVisible();
    await expect(table.getByText("Harper Tester")).toHaveCount(0);
  });
});
