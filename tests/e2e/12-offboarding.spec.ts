import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * Leaving, driven through the screens.
 *
 * The whole arc in one journey, because each step exists only once the one
 * before it has happened — there is no way to reach "confirm" without a
 * resignation that somebody has approved.
 *
 * Against a leaver of its own rather than one of the personas: the journey
 * ends with the person exited and their login disabled, and doing that to a
 * persona would take every other spec down with it.
 *
 * Desktop only. There is one leaver and an exit happens once, so the second
 * project would arrive to find it already done.
 */

test.describe.configure({ mode: "serial" });

/** Open the leaver's record and land on the tab that runs the exit. */
async function openLeaver(page: import("@playwright/test").Page) {
  await page.goto("/hr/employees");
  await page.locator("tr").filter({ hasText: "Rowan Departs" }).locator("a").first().click();
  await page.getByRole("tab", { name: "Leaving" }).click();
}

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("files the resignation somebody handed in elsewhere", async ({ page }) => {
    await openLeaver(page);

    await page.getByRole("button", { name: "File a resignation" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Last working day they asked for").fill("2027-02-26");
    await dialog.getByLabel("Reason given").fill("Moving to another city.");
    await dialog.getByRole("button", { name: "File it" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Awaiting approval").first()).toBeVisible();
  });

  test("shows it on the leaving list", async ({ page }) => {
    await page.goto("/hr/offboarding");

    const row = page.locator("tr").filter({ hasText: "Rowan Departs" });
    await expect(row).toBeVisible();
    await expect(row.getByText("Awaiting approval")).toBeVisible();
  });

  test("approves it, then settles the last working day", async ({ page }) => {
    await openLeaver(page);

    await page.getByRole("button", { name: "Approve the resignation" }).click();
    await expect(page.getByRole("button", { name: /Confirm and set the last day/ })).toBeVisible();

    await page.getByRole("button", { name: /Confirm and set the last day/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Last working day").fill("2027-02-26");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("On notice").first()).toBeVisible();
    // Confirming is what starts the checklist.
    await expect(page.getByText("Return the laptop")).toBeVisible();
  });

  test("cannot clear while the checklist is outstanding", async ({ page }) => {
    await openLeaver(page);

    await page.getByRole("button", { name: "Mark everything cleared" }).click();
    // The refusal names the task rather than counting it.
    await expect(page.getByText(/Return the laptop/).first()).toBeVisible();
  });

  test("settles the tasks, clears, records what is owed and closes the exit", async ({ page }) => {
    await openLeaver(page);

    for (const title of ["Return the laptop", "Revoke access"]) {
      await page
        .locator("li")
        .filter({ hasText: title })
        .getByRole("button", { name: "Done" })
        .click();
    }

    await page.getByRole("button", { name: "Mark everything cleared" }).click();

    await page.getByRole("button", { name: "Record the settlement" }).click();
    const settle = page.getByRole("dialog");
    await settle.getByLabel("Leave days to encash").fill("4.5");
    await settle.getByRole("button", { name: "Record it" }).click();
    await expect(settle).toBeHidden();

    await page.getByRole("button", { name: "Complete the exit" }).click();
    await expect(page.getByText("Left").first()).toBeVisible();
  });
});

test.describe("anybody with a profile", () => {
  test.use({ storageState: STATE.hr });

  test("is offered a way to resign on their own profile", async ({ page }) => {
    /*
     * The HR persona, because they are the one whose profile setup is
     * already stamped in the fixture. The employee and the manager are left
     * unstamped for the setup journey, so their profile shows the welcome
     * form — and asserting here against one of them would have made this
     * spec depend on that one having run first.
     */
    await page.goto("/me/profile");
    await expect(page.getByRole("button", { name: "Resign", exact: true })).toBeVisible();
  });
});

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("cannot reach the offboarding screens", async ({ page }) => {
    await page.goto("/hr/offboarding");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();
  });
});
