import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * A company defining a role of its own.
 *
 * The journey exists for one assertion in the middle of it: the permission an
 * HR administrator does not hold cannot be ticked. `roles.manage` belongs to
 * hr_admin, so without that, this screen is a way to write yourself a
 * super-administrator role.
 *
 * Desktop only. It creates a role, so a second project would find the name
 * taken.
 */

test.describe.configure({ mode: "serial" });

const ROLE = "e2erecruiter";

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("sees the four system roles, and cannot edit them", async ({ page }) => {
    await page.goto("/admin/roles");

    // Exact: "HR admin" also appears inside that role's own description.
    await expect(page.getByText("Super admin", { exact: true })).toBeVisible();
    await expect(page.getByText("HR admin", { exact: true })).toBeVisible();

    // No edit or delete on a system role: the buttons are not rendered.
    await expect(page.getByRole("button", { name: /Edit HR admin/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Delete Employee/ })).toHaveCount(0);
  });

  test("cannot tick a permission it does not hold", async ({ page }) => {
    await page.goto("/admin/roles");
    await page.getByRole("button", { name: "Add role" }).click();

    const dialog = page.getByRole("dialog");
    // `platform.manage` is the one permission hr_admin lacks.
    await expect(
      dialog.locator('label:has-text("platform.manage") [role="checkbox"]').first(),
    ).toBeDisabled();
    // And one it does hold, so the test is not passing because everything is off.
    await expect(
      dialog.locator('label:has-text("recruitment.manage") [role="checkbox"]').first(),
    ).toBeEnabled();
  });

  test("creates a role of its own", async ({ page }) => {
    await page.goto("/admin/roles");
    await page.getByRole("button", { name: "Add role" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(ROLE);
    await dialog.getByLabel("Description").fill("Hiring, and nothing else");
    await dialog
      .locator('label:has-text("recruitment.view_all") [role="checkbox"]')
      .first()
      .click();
    await dialog.getByRole("button", { name: "Create role" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(ROLE, { exact: true })).toBeVisible();
    await expect(page.getByText("recruitment.view_all").first()).toBeVisible();
  });

  test("deletes it again, because nobody holds it", async ({ page }) => {
    await page.goto("/admin/roles");
    await page.getByRole("button", { name: new RegExp(`Delete ${ROLE}`) }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Nobody holds it")).toBeVisible();
    await dialog.getByRole("button", { name: "Delete role" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(ROLE, { exact: true })).toHaveCount(0);
  });
});

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("cannot reach the roles screen at all", async ({ page }) => {
    await page.goto("/admin/roles");

    await expect(page.getByText(/roles.view_all/)).toBeVisible();
  });
});
