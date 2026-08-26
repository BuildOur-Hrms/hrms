import { chromium } from "playwright";

/**
 * The audit the page-level one cannot do: open each screen's dialogs and look
 * at the controls inside them.
 *
 * Most of this app's forms live in a dialog, so a sweep that only reads what
 * is already on screen misses almost every input in the product.
 */

const BASE = process.env.AUDIT_URL ?? "http://localhost:3000";
const EMAIL = process.env.AUDIT_EMAIL ?? "hr@e2e.test";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "e2e-Password-1234";

const TARGETS = [
  ["/hr/leave", "Add type"],
  ["/hr/employees", "Add employee"],
  ["/hr/shifts", "Add shift"],
  ["/hr/departments", "Add department"],
  ["/hr/announcements", "New announcement"],
  ["/admin/locations", "Add location"],
  ["/me/leave", "Apply for leave"],
  ["/admin/settings", null],
  ["/me/profile", null],
];

const DIALOG_AUDIT = () => {
  const scope = document.querySelector('[role="dialog"]') ?? document.body;
  const issues = [];
  const named = (el) => {
    if (el.getAttribute("aria-label")?.trim()) return true;
    const lb = el.getAttribute("aria-labelledby");
    if (lb && lb.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim()))
      return true;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return true;
    if (el.closest("label") && ["input", "select", "textarea"].includes(el.tagName.toLowerCase()))
      return true;
    if (el.textContent?.trim()) return true;
    if (el.getAttribute("title")?.trim()) return true;
    return false;
  };

  const sel =
    'input:not([type="hidden"]), select, textarea, [role="checkbox"], [role="switch"], [role="combobox"], [role="radio"]';
  for (const el of scope.querySelectorAll(sel)) {
    if (el.offsetParent === null) continue;
    // Base UI's Select renders its own hidden text input to carry the value
    // into a form. It is not a control anybody interacts with, and the
    // trigger beside it is the thing that carries the label.
    if (el.id?.includes("-hidden-input")) continue;

    if (!named(el)) {
      const role = el.getAttribute("role");
      const near = el.closest("label")?.textContent?.trim().slice(0, 40) ?? "";
      const prev = el.previousElementSibling?.textContent?.trim().slice(0, 30) ?? "";
      const parentLabel =
        el.parentElement?.querySelector("label")?.textContent?.trim().slice(0, 30) ?? "";
      issues.push(
        [
          `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}`,
          el.type ? `type=${el.type}` : "",
          el.name ? `name=${el.name}` : "",
          el.placeholder ? `ph="${el.placeholder}"` : "",
          el.id ? `id=${el.id}` : "NO-ID",
          near ? `inLabel="${near}"` : "",
          prev ? `after="${prev}"` : "",
          parentLabel ? `siblingLabel="${parentLabel}"` : "",
        ]
          .filter(Boolean)
          .join("  "),
      );
    }
  }
  return { inDialog: scope !== document.body, issues };
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 20_000 });

  for (const [route, trigger] of TARGETS) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 25_000 });
      await page.waitForTimeout(500);

      if (trigger) {
        const button = page.getByRole("button", { name: trigger }).first();
        if ((await button.count()) === 0) {
          console.log(`${route}  (no "${trigger}" button found)`);
          continue;
        }
        await button.click();
        await page.waitForTimeout(700);
      }

      const result = await page.evaluate(DIALOG_AUDIT);
      const where = trigger ? `${route} → "${trigger}"` : route;
      if (result.issues.length === 0) {
        console.log(`OK   ${where}${trigger && !result.inDialog ? "  (dialog did not open)" : ""}`);
      } else {
        console.log(`FAIL ${where}  — ${result.issues.length} unnamed`);
        for (const row of result.issues.slice(0, 8)) console.log("       " + row);
      }
    } catch (error) {
      console.log(`ERR  ${route}  ${String(error).split("\n")[0].slice(0, 90)}`);
    }
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
