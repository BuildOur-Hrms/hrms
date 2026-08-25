import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * A review cycle, driven through the screens.
 *
 * Three people touch one review and none of them may write another's half,
 * so the journey moves between them: the employee sets a goal and rates
 * themselves, their manager agrees the goals and rates them, HR opens and
 * closes the cycle around both.
 *
 * Desktop only. There is one cycle in the fixture and a review is written
 * once, so the second project would find the work already done.
 */

test.describe.configure({ mode: "serial" });

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("sets a goal against the open cycle", async ({ page }) => {
    await page.goto("/me/performance");

    await expect(page.getByText("E2E cycle")).toBeVisible();
    await page.getByRole("button", { name: "Add a goal" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What are you working towards?").fill("Ship the reporting rewrite");
    await dialog.getByLabel("Weight").fill("3");
    await dialog.getByRole("button", { name: "Add it" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Ship the reporting rewrite")).toBeVisible();
    // Nobody has agreed it yet, and the screen says so.
    await expect(page.getByText("Not agreed")).toBeVisible();
  });
});

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("opens the cycle for reviews, which creates them", async ({ page }) => {
    await page.goto("/hr/performance");

    await page.getByRole("button", { name: "Open reviews" }).click();
    // The cycle moves on, and the stage badge follows it.
    await expect(page.getByText("Reviews open").first()).toBeVisible();
  });
});

test.describe("the employee again", () => {
  test.use({ storageState: STATE.employee });

  test("cannot add a goal once reviews are open", async ({ page }) => {
    await page.goto("/me/performance");

    // Adding one now would change what they are being reviewed against.
    await expect(page.getByRole("button", { name: "Add a goal" })).toHaveCount(0);
    await expect(page.getByText(/Goals are closed/)).toBeVisible();
  });

  test("writes their own half", async ({ page }) => {
    await page.goto("/me/performance");

    await page.getByRole("radio", { name: /^4 ·/ }).click();
    await page.getByLabel("In your own words").fill("A good half year, on the whole.");
    await page.getByRole("button", { name: "Submit my review" }).click();

    // The form is replaced by what they said — it cannot be edited after.
    await expect(page.getByText("You said")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit my review" })).toHaveCount(0);
  });
});

test.describe("their manager", () => {
  test.use({ storageState: STATE.manager });

  test("agrees the goals and writes their half", async ({ page }) => {
    await page.goto("/team/performance");

    /*
     * The row that holds both the name and its own button.
     *
     * Filtering on the name alone matches every ancestor including the list
     * itself, and `.last()` then clicks whichever button happens to come last
     * in the whole list — which opened somebody else's review.
     */
    const open = page.getByRole("button", { name: /Write it|Open/ });
    await page
      .locator("div")
      .filter({ hasText: "Eli Tester" })
      .filter({ has: open })
      .last()
      .getByRole("button", { name: /Write it|Open/ })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Ship the reporting rewrite")).toBeVisible();

    await dialog.getByRole("button", { name: "Agree the set" }).click();
    await expect(dialog.getByRole("button", { name: "Agree the set" })).toHaveCount(0);

    // What the person said is on the same screen as the rating box, so
    // nobody is rating a memory.
    await expect(dialog.getByText("A good half year, on the whole.")).toBeVisible();

    await dialog.getByRole("radio", { name: /^3 ·/ }).click();
    await dialog.getByLabel("Your assessment").fill("Solid, with more to come.");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Done").first()).toBeVisible();
  });
});

test.describe("HR again", () => {
  test.use({ storageState: STATE.hr });

  test("sees the completion and the shape of the ratings", async ({ page }) => {
    await page.goto("/hr/performance");

    await expect(page.getByText("How the ratings fell")).toBeVisible();
    // The manager's rating seeds the final one.
    await expect(page.getByText(/average 3/)).toBeVisible();
  });
});

test.describe("somebody with no team", () => {
  test.use({ storageState: STATE.employee });

  test("cannot reach the team or company screens", async ({ page }) => {
    await page.goto("/team/performance");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();

    await page.goto("/hr/performance");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();
  });
});
