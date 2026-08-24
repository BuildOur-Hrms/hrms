import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * What a new joiner meets after accepting an invite.
 *
 * The fixture leaves everybody unstamped, which is exactly the state an
 * invited account arrives in.
 */

test.describe.configure({ mode: "serial" });

test.describe("a new joiner", () => {
  test.use({ storageState: STATE.employee });

  test("is prompted from their home page", async ({ page }) => {
    await page.goto("/me");
    await expect(page.getByText("Finish setting up your profile")).toBeVisible();
  });

  test("meets the setup form instead of an empty profile", async ({ page }) => {
    await page.goto("/me/profile");

    await expect(page.getByText("Welcome — tell us about you")).toBeVisible();
    // Pre-filled with what HR typed, so the common case is confirming a name.
    await expect(page.getByLabel("First name")).toHaveValue("Eli");
  });

  test("fills it in and lands on their profile", async ({ page }) => {
    await page.goto("/me/profile");

    /*
     * Deliberately not the name.
     *
     * Renaming the fixture employee here broke every other spec that finds
     * somebody by name — the specs run against one database, and this one
     * was quietly changing what the others look for. That an employee may
     * correct their own name is proven in the integration suite, where it
     * costs nothing to change it back.
     */
    await page.getByLabel("Phone").fill("+91 90000 00000");
    await page.getByLabel("Personal email").fill("eli@personal.test");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // The form is replaced by the real profile.
    await expect(page.getByText("Welcome — tell us about you")).toHaveCount(0);
    await expect(page.getByText("+91 90000 00000")).toBeVisible();
  });

  test("is not prompted again", async ({ page }) => {
    await page.goto("/me");
    await expect(page.getByText("Finish setting up your profile")).toHaveCount(0);
  });

  test("can still edit everything that is theirs, and nothing that is not", async ({ page }) => {
    await page.goto("/me/profile");
    await page.getByRole("button", { name: "Edit" }).first().click();

    const dialog = page.getByRole("dialog");
    for (const field of ["First name", "Last name", "Date of birth", "Gender", "Phone"]) {
      await expect(dialog.getByLabel(field, { exact: true }), field).toBeVisible();
    }

    // The company's fields are not in the form at all, which is a better
    // guarantee than a disabled input somebody can re-enable.
    for (const field of ["Department", "Designation", "Join date", "Work email"]) {
      await expect(dialog.getByLabel(field, { exact: true }), field).toHaveCount(0);
    }
  });
});

test.describe("skipping", () => {
  test.use({ storageState: STATE.manager });

  test("dismisses the prompt without filling anything in", async ({ page }) => {
    await page.goto("/me/profile");
    await expect(page.getByText("Welcome — tell us about you")).toBeVisible();

    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByText("Welcome — tell us about you")).toHaveCount(0);
  });
});
