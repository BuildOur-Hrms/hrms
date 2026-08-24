import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * Hiring, driven through the screens.
 *
 * The whole arc in one journey — role, candidate, rounds, offer — because
 * each step only matters if the one before it left the board in the state the
 * next one needs.
 */

/**
 * Names scoped to the project, and deterministic within it.
 *
 * Desktop and mobile run this journey against one database, so a shared name
 * means the second project finds two of everything and every locator becomes
 * ambiguous. Deterministic rather than timestamped because the fixture clears
 * the pipeline on each seed — a fresh value per run would leave the board
 * filling with abandoned roles instead.
 */
function scope(project: string) {
  return {
    role: `Platform Engineer (${project})`,
    name: `Rue ${project}`,
    email: `rue-${project}@example.test`,
  };
}

/**
 * The card for one role.
 *
 * Matched on containing both the title and the board button, rather than on
 * the title alone: `hasText` matches every ancestor, and picking the deepest
 * one lands on a paragraph that holds no buttons at all.
 */
function roleCard(page: import("@playwright/test").Page, role: string) {
  return page
    .locator("div")
    .filter({ hasText: role })
    .filter({ has: page.getByRole("button", { name: /Open board/ }) })
    .last();
}

test.describe.configure({ mode: "serial" });

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("creates a role and publishes it", async ({ page }) => {
    const { role } = scope(test.info().project.name);
    await page.goto("/hr/recruitment");

    await page.getByRole("button", { name: "New role" }).click();
    await page.getByLabel("Title").fill(role);
    await page.getByLabel("Department").click();
    await page.getByRole("option", { name: "Engineering" }).click();
    await page.getByLabel("Designation").click();
    await page.getByRole("option", { name: "Engineer" }).click();
    await page.getByLabel("Location").click();
    await page.getByRole("option", { name: "Head office" }).click();
    await page.getByRole("button", { name: "Create it" }).click();

    await expect(roleCard(page, role)).toBeVisible();

    await roleCard(page, role).getByRole("button", { name: "Publish" }).click();
    // Exact: the card also says "1 opening" and "Open board", and a substring
    // match on "open" finds all three.
    await expect(roleCard(page, role).getByText("open", { exact: true })).toBeVisible();
  });

  test("adds a candidate onto the board", async ({ page }) => {
    const { role, name, email } = scope(test.info().project.name);
    await page.goto("/hr/recruitment");
    await roleCard(page, role)
      .getByRole("button", { name: /Open board/ })
      .click();

    await page.getByRole("button", { name: "Add a candidate" }).click();
    await page.getByLabel("First name").fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Add them" }).click();

    await expect(page.getByText(name)).toBeVisible();
  });

  test("moves them along", async ({ page }) => {
    const { role, name } = scope(test.info().project.name);
    await page.goto("/hr/recruitment");
    await roleCard(page, role)
      .getByRole("button", { name: /Open board/ })
      .click();

    await page.getByText(name).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name })).toBeVisible();

    await drawer.getByRole("button", { name: "Interview", exact: true }).click();
    await expect(drawer.getByText("Interview").first()).toBeVisible();
  });

  test("cannot reject without saying why", async ({ page }) => {
    const { role, name } = scope(test.info().project.name);
    await page.goto("/hr/recruitment");
    await roleCard(page, role)
      .getByRole("button", { name: /Open board/ })
      .click();
    await page.getByText(name).click();

    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(drawer.getByRole("button", { name: "Reject this application" })).toBeDisabled();
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
