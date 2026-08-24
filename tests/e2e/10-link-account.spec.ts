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

  test("does not offer an account that already belongs to somebody", async ({ page }) => {
    await page.goto("/hr/employees");
    await page.getByRole("link", { name: /Eli/ }).first().click();

    // Already linked, so neither offer is on the page at all.
    await expect(page.getByRole("button", { name: "Link an account" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Send invite" })).toBeHidden();
  });
});
