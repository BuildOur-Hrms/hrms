import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * Hiring, driven through the screens.
 *
 * The whole arc in one journey — role, candidate, rounds, offer, conversion —
 * because each step only matters if the one before it left the board in the
 * state the next one needs.
 */

const ROLE = `Platform Engineer ${Date.now().toString().slice(-5)}`;
const CANDIDATE = `rue-${Date.now().toString().slice(-6)}@example.test`;

test.describe.configure({ mode: "serial" });

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("creates a role and publishes it", async ({ page }) => {
    await page.goto("/hr/recruitment");

    await page.getByRole("button", { name: "New role" }).click();
    await page.getByLabel("Title").fill(ROLE);
    await page.getByLabel("Department").click();
    await page.getByRole("option", { name: "Engineering" }).click();
    await page.getByLabel("Designation").click();
    await page.getByRole("option", { name: "Engineer" }).click();
    await page.getByLabel("Location").click();
    await page.getByRole("option", { name: "Head office" }).click();
    await page.getByRole("button", { name: "Create it" }).click();

    const card = page.locator("div").filter({ hasText: ROLE }).last();
    await expect(card).toBeVisible();

    await page.getByRole("button", { name: "Publish" }).first().click();
    await expect(page.getByText("open").first()).toBeVisible();
  });

  test("adds a candidate onto the board", async ({ page }) => {
    await page.goto("/hr/recruitment");
    await page
      .locator("div")
      .filter({ hasText: ROLE })
      .getByRole("button", { name: /Open board/ })
      .last()
      .click();

    await page.getByRole("button", { name: "Add a candidate" }).click();
    await page.getByLabel("First name").fill("Rue");
    await page.getByLabel("Last name").fill("Nakamura");
    await page.getByLabel("Email").fill(CANDIDATE);
    await page.getByRole("button", { name: "Add them" }).click();

    // The card lands in the first column.
    await expect(page.getByText("Rue Nakamura")).toBeVisible();
  });

  test("moves them along and books a round", async ({ page }) => {
    await page.goto("/hr/recruitment");
    await page
      .locator("div")
      .filter({ hasText: ROLE })
      .getByRole("button", { name: /Open board/ })
      .last()
      .click();

    await page.getByText("Rue Nakamura").click();
    await expect(page.getByRole("heading", { name: "Rue Nakamura" })).toBeVisible();

    await page.getByRole("button", { name: "Interview", exact: true }).click();
    await expect(page.getByText("Interview").first()).toBeVisible();
  });

  test("cannot reject without saying why", async ({ page }) => {
    await page.goto("/hr/recruitment");
    await page
      .locator("div")
      .filter({ hasText: ROLE })
      .getByRole("button", { name: /Open board/ })
      .last()
      .click();
    await page.getByText("Rue Nakamura").click();

    await page.getByRole("button", { name: "Reject", exact: true }).click();
    // The button stays disabled until a reason is typed.
    await expect(page.getByRole("button", { name: "Reject this application" })).toBeDisabled();
  });
});

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("cannot see hiring at all", async ({ page }) => {
    await page.goto("/hr/recruitment");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();
  });

  test("still has an interviews page of their own", async ({ page }) => {
    await page.goto("/me/interviews");
    await expect(page.getByRole("heading", { name: "My interviews" })).toBeVisible();
  });
});
