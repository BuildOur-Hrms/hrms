import { expect, test } from "@playwright/test";

import { STATE } from "./fixtures";

/**
 * Locking a month, and what it costs everybody else.
 *
 * This is the guard payroll depends on: once a month is closed the numbers
 * behind it stop moving. The journey locks, proves an employee can no longer
 * punch, and reopens — leaving the month as it found it, because a test that
 * left production-shaped data frozen would be a test nobody dared run twice.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const thisMonth = MONTHS[new Date().getUTCMonth()]!;

test("HR locks the current month, and an employee can no longer punch", async ({ browser }) => {
  const hrContext = await browser.newContext({ storageState: STATE.hr });
  const hr = await hrContext.newPage();
  await hr.goto("/hr/attendance");

  await hr.getByRole("button", { name: thisMonth, exact: true }).click();
  await hr.getByRole("button", { name: "Lock the month" }).click();
  await expect(hr.getByText(/locked by/i).first()).toBeVisible();

  const employeeContext = await browser.newContext({ storageState: STATE.employee });
  const employee = await employeeContext.newPage();
  await employee.goto("/me/attendance");

  await employee.getByRole("button", { name: /^Check (in|out)$/ }).click();
  await expect(employee.getByText(/lock/i).first()).toBeVisible();

  // Put it back, whatever happened above.
  await hr.reload();
  await hr.getByRole("button", { name: thisMonth, exact: true }).click();
  await hr.getByRole("button", { name: "Reopen the month" }).click();

  await employeeContext.close();
  await hrContext.close();
});

test.describe("a manager", () => {
  test.use({ storageState: STATE.manager });

  test("cannot lock a month", async ({ page }) => {
    await page.goto("/hr/attendance");
    await expect(page.getByText(/do not have|cannot|permission/i).first()).toBeVisible();
  });
});
