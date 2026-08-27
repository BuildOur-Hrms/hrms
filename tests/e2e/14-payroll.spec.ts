import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * Payroll, driven through the screens.
 *
 * The fixture has no salaries and no locked month, and that is deliberate
 * here: what this journey proves is the two things standing between HR and a
 * wrong payment — the refusal to open a month whose attendance can still
 * move, and the warning about people who would be paid nothing.
 *
 * Desktop only. It adds a salary component, so a second project would find
 * the code already taken.
 */

test.describe.configure({ mode: "serial" });

const COMPONENT_CODE = "E2EBASIC";

test.describe("HR", () => {
  test.use({ storageState: STATE.hr });

  test("finds payroll laid out as the work happens", async ({ page }) => {
    await page.goto("/hr/payroll");

    await expect(page.getByRole("heading", { name: "Payroll", level: 1 })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Runs" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Preview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Components" })).toBeVisible();
  });

  test("adds a salary component", async ({ page }) => {
    await page.goto("/hr/payroll");
    await page.getByRole("tab", { name: "Components" }).click();
    await page.getByRole("button", { name: "Add component" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Code").fill(COMPONENT_CODE);
    await dialog.getByLabel("Name").fill("Basic pay");
    await dialog.getByRole("button", { name: "Add component" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(COMPONENT_CODE)).toBeVisible();
    // Prorating is on by default, which is what "shrinks with unpaid leave"
    // has to mean for pay.
    await expect(page.getByRole("row", { name: /Basic pay/ }).getByText("Yes")).toBeVisible();
  });

  test("will not open a month whose attendance is still unlocked", async ({ page }) => {
    await page.goto("/hr/payroll");
    await page.getByRole("button", { name: "Open a month" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Open month" }).click();

    // The whole reason the guard exists, said in the dialog rather than as a
    // toast that disappears before it is read.
    await expect(dialog.getByText(/lock attendance/i)).toBeVisible();
  });

  test("says who would be paid nothing before anybody approves anything", async ({ page }) => {
    await page.goto("/hr/payroll");
    await page.getByRole("tab", { name: "Preview" }).click();

    // Nothing is calculated until it is asked for.
    await expect(page.getByText("Pick a month")).toBeVisible();
    await page.getByRole("button", { name: "Work it out" }).click();

    await expect(page.getByText(/no salary on record and would be paid nothing/)).toBeVisible();
  });
});

test.describe("an employee", () => {
  test.use({ storageState: STATE.employee });

  test("has a payslips page of their own", async ({ page }) => {
    await page.goto("/me/payslips");

    await expect(page.getByRole("heading", { name: "My payslips", level: 1 })).toBeVisible();
    await expect(page.getByText("No payslips yet")).toBeVisible();
  });

  test("cannot reach the company payroll screens", async ({ page }) => {
    await page.goto("/hr/payroll");

    await expect(page.getByText(/payroll.view_all/)).toBeVisible();
  });
});
