import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * Connecting a login that exists to a person who exists.
 *
 * The fixture leaves both halves apart: an account invited directly, with no
 * employee record, and a record with no account. Before this existed there
 * was no way to put them together — the person was told to ask HR, and HR had
 * nothing to click.
 *
 * Desktop only. The two projects share a database and there is one pair to
 * link, so the second project would find the work already done.
 */

test.describe.configure({ mode: "serial" });

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("links an account to somebody who has none", async ({ page }) => {
    await page.goto("/hr/employees");
    await page.getByRole("link", { name: /Unlinked Person/ }).click();

    await page.getByRole("button", { name: "Link an account" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Link an account" })).toBeVisible();

    await dialog.getByLabel("Account").click();
    await page.getByRole("option", { name: /stray@/ }).click();
    await dialog.getByRole("button", { name: "Link it" }).click();

    await expect(dialog).toBeHidden();
    // The offer is gone, because the record now has an account.
    await expect(page.getByRole("button", { name: "Link an account" })).toBeHidden();
  });

  test("creates a record from the users screen for an account that has none", async ({ page }) => {
    await page.goto("/admin/users");

    const row = page.locator("tr").filter({ hasText: "stray2@" });
    await expect(row.getByText("No employee record")).toBeVisible();

    await row.getByRole("button", { name: /Create an employee record/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create their employee record" }),
    ).toBeVisible();
    // Their sign-in address, filled in for them.
    await expect(dialog.getByLabel("Work email")).toHaveValue(/stray2@/);

    await dialog.getByLabel("First name").fill("Adopted");
    await dialog.getByLabel("Department").click();
    await page.getByRole("option", { name: "Engineering" }).click();
    await dialog.getByLabel("Designation").click();
    await page.getByRole("option", { name: "Engineer" }).click();
    await dialog.getByLabel("Location").click();
    await page.getByRole("option", { name: "Head office" }).click();

    await dialog.getByRole("button", { name: "Add employee" }).click();
    await expect(dialog).toBeHidden();

    // The row now names the person rather than the address, and the warning
    // is gone — which is the whole point of the action.
    await expect(page.locator("tr").filter({ hasText: "stray2@" })).toContainText("Adopted");
    await expect(page.getByText("No employee record")).toHaveCount(0);
  });

  test("does not offer an account that already belongs to somebody", async ({ page }) => {
    await page.goto("/hr/employees");
    await page.getByRole("link", { name: /Eli/ }).first().click();

    // Already linked, so neither offer is on the page at all.
    await expect(page.getByRole("button", { name: "Link an account" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Send invite" })).toBeHidden();
  });
});
