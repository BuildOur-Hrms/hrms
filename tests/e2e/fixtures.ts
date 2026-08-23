import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the browser journeys.
 *
 * Credentials come from `scripts/seed-e2e.ts`, which is the only place in the
 * project that writes a password — and refuses to run outside development and
 * test.
 */

export const PASSWORD = "e2e-Password-1234";

/**
 * Where each role's signed-in cookies are kept.
 *
 * Written once by `auth.setup.ts` and reused by every journey. Lives here
 * rather than in the setup file because Playwright forbids one test file
 * importing another, and a saved session is a fixture, not a test.
 */
export const STATE_DIR = "playwright/.auth";

export const STATE = {
  hr: `${STATE_DIR}/hr.json`,
  manager: `${STATE_DIR}/manager.json`,
  employee: `${STATE_DIR}/employee.json`,
} as const;

export const USERS = {
  hr: "hr@e2e.test",
  manager: "manager@e2e.test",
  employee: "employee@e2e.test",
} as const;

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Waiting for the shell rather than the URL. The URL changes the moment
  // navigation starts, which is before the page it navigated to exists —
  // asserting on anything inside it at that point is a race.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
    timeout: 30_000,
  });
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/**
 * A working day far enough ahead that no earlier run has claimed it.
 *
 * Leave requests may not overlap, so a fixed date works exactly once. The
 * offset walks forward from a base and skips weekends, which the day count
 * refuses outright.
 */
export function futureWorkingDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 60 + offsetDays);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

/** Minutes since midnight, so successive runs pick different dates. */
export function runOffset(): number {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}
