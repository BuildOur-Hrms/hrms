import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * A new joiner, from a checklist nobody has started to somebody active.
 *
 * The step worth having is the refusal: activating somebody with a required
 * task outstanding must fail, and must say which task. A checklist that can
 * be walked past is decoration.
 *
 * Desktop only. There is one joiner in the fixture and starting their
 * checklist happens once, so the second project would arrive to find the work
 * already done.
 */

/**
 * Open the joiner's record from the arriving list.
 *
 * The anchor directly, not `getByRole("link")`: the button-shaped links in
 * this app render an `<a>` that carries button semantics, so it does not
 * answer to the link role.
 */
async function openJoiner(page: import("@playwright/test").Page) {
  await page.locator("tr").filter({ hasText: "Nadia Arrives" }).locator("a").first().click();
}

test.describe.configure({ mode: "serial" });

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("sees who is arriving, and that nothing has started", async ({ page }) => {
    await page.goto("/hr/onboarding");

    const row = page.locator("tr").filter({ hasText: "Nadia Arrives" });
    await expect(row).toBeVisible();
    await expect(row.getByText("Not started")).toBeVisible();
  });

  test("starts the checklist from the person's record", async ({ page }) => {
    await page.goto("/hr/onboarding");
    await openJoiner(page);

    await page.getByRole("tab", { name: "Onboarding" }).click();
    await page.getByRole("button", { name: "Start onboarding" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /Start onboarding/ })).toBeVisible();
    await dialog.getByRole("button", { name: "Start it" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Laptop ready")).toBeVisible();
    await expect(page.getByText("Sign the contract")).toBeVisible();
  });

  test("will not activate them while a required task is outstanding", async ({ page }) => {
    await page.goto("/hr/onboarding");
    await openJoiner(page);

    await page.getByRole("button", { name: "Change status" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New status").click();
    await page.getByRole("option", { name: "Active" }).click();
    await dialog.getByRole("button", { name: "Apply" }).click();

    // The refusal names what is missing, rather than counting it.
    await expect(page.getByText(/Laptop ready/).first()).toBeVisible();
  });

  test("skips one task with a reason and completes the other", async ({ page }) => {
    await page.goto("/hr/onboarding");
    await openJoiner(page);
    await page.getByRole("tab", { name: "Onboarding" }).click();

    const laptop = page.locator("li").filter({ hasText: "Laptop ready" });
    await laptop.getByRole("button", { name: "Skip" }).click();

    const skipDialog = page.getByRole("dialog");
    await skipDialog.getByLabel("Why is it being skipped?").fill("They bring their own machine.");
    await skipDialog.getByRole("button", { name: "Skip it" }).click();
    await expect(skipDialog).toBeHidden();

    await page
      .locator("li")
      .filter({ hasText: "Sign the contract" })
      .getByRole("button", { name: "Done" })
      .click();

    await expect(page.getByText("They bring their own machine.")).toBeVisible();
  });

  test("activates them once the optional task is all that is left", async ({ page }) => {
    await page.goto("/hr/onboarding");
    await openJoiner(page);

    await page.getByRole("button", { name: "Change status" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New status").click();
    await page.getByRole("option", { name: "Active" }).click();
    await dialog.getByRole("button", { name: "Apply" }).click();

    await expect(dialog).toBeHidden();
    // Off the arriving list, because they have arrived.
    await page.goto("/hr/onboarding");
    await expect(page.locator("tr").filter({ hasText: "Nadia Arrives" })).toHaveCount(0);
  });
});

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("cannot reach the onboarding screens", async ({ page }) => {
    await page.goto("/hr/onboarding");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();
  });
});
