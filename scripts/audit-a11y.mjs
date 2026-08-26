import { chromium } from "playwright";

/**
 * Walks the app as a signed-in HR admin and reports the interface faults that
 * are cheap to detect and expensive to miss: controls with no accessible
 * name, pages that scroll sideways on a phone, images with no alt, touch
 * targets under the platform minimum, and broken heading order.
 *
 * Run against a dev server that is already up:
 *   npx tsx scripts/build-changelog-pdf.ts   # (unrelated, see docs)
 *   node scripts/audit-a11y.mjs [--mobile]
 *
 * It reports; it does not judge. Some of what it finds is fine in context —
 * a 36px-high link on a desktop sidebar is not a touch target. The point is
 * to put the whole list in front of a person instead of finding them one
 * screen at a time.
 */

const BASE = process.env.AUDIT_URL ?? "http://localhost:3000";
const MOBILE = process.argv.includes("--mobile");
const EMAIL = process.env.AUDIT_EMAIL ?? "hr@e2e.test";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "e2e-Password-1234";

const ROUTES = [
  "/dashboard",
  "/me",
  "/me/profile",
  "/me/attendance",
  "/me/leave",
  "/me/tasks",
  "/me/performance",
  "/me/notifications",
  "/hr",
  "/hr/employees",
  "/hr/attendance",
  "/hr/leave",
  "/hr/shifts",
  "/hr/departments",
  "/hr/announcements",
  "/hr/onboarding",
  "/hr/offboarding",
  "/hr/recruitment",
  "/hr/performance",
  "/hr/tasks",
  "/hr/reports",
  "/team",
  "/team/attendance",
  "/team/leave-approvals",
  "/team/tasks",
  "/team/performance",
  "/admin/users",
  "/admin/roles",
  "/admin/company",
  "/admin/locations",
  "/admin/settings",
  "/admin/audit-logs",
];

const AUDIT = () => {
  const out = { url: location.pathname, issues: [] };
  const add = (kind, detail) => out.issues.push({ kind, detail });
  const label = (el) =>
    (el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 24);

  const named = (el) => {
    if (el.getAttribute("aria-label")?.trim()) return true;
    const lb = el.getAttribute("aria-labelledby");
    if (lb && lb.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim()))
      return true;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return true;
    // A wrapping <label> only names form-associated elements. A
    // <button role="checkbox"> inside one gets nothing from it.
    if (el.closest("label") && ["input", "select", "textarea"].includes(el.tagName.toLowerCase()))
      return true;
    if (el.textContent?.trim()) return true;
    if (el.getAttribute("title")?.trim()) return true;
    return false;
  };

  const selector =
    'button, a[href], input:not([type="hidden"]), select, textarea,' +
    '[role="checkbox"], [role="switch"], [role="combobox"], [role="radio"]';
  for (const el of document.querySelectorAll(selector)) {
    if (el.offsetParent === null) continue;
    // Base UI's Select renders its own hidden text input to carry the value
    // into a form. It is not a control anybody interacts with, and the
    // trigger beside it is the thing that carries the label.
    if (el.id?.includes("-hidden-input")) continue;

    if (!named(el)) {
      const role = el.getAttribute("role");
      add(
        "no-accessible-name",
        `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""} .${String(el.className).split(" ").slice(0, 2).join(".")}`,
      );
    }
  }

  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    const wide = [...document.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
      .slice(0, 3)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")}`,
      );
    add("horizontal-scroll", `${de.scrollWidth} > ${de.clientWidth} :: ${wide.join(" | ")}`);
  }

  for (const img of document.querySelectorAll("img")) {
    if (!img.hasAttribute("alt")) add("img-no-alt", String(img.getAttribute("src")).slice(0, 50));
  }

  const small = [];
  for (const el of document.querySelectorAll(
    'button, a[href], [role="checkbox"], [role="switch"]',
  )) {
    if (el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 44) small.push(`${Math.round(r.width)}x${Math.round(r.height)} "${label(el)}"`);
  }
  if (small.length) add("small-touch-target", `${small.length} :: ${small.slice(0, 4).join("; ")}`);

  const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      add("heading-skip", `h${levels[i - 1]} -> h${levels[i]}`);
      break;
    }
  }
  if (levels.length && levels[0] !== 1) add("no-h1", `first heading is h${levels[0]}`);

  for (const t of document.querySelectorAll("table")) {
    const scroller = t.closest('[class*="overflow-x"], [class*="overflow-auto"]');
    const w = t.getBoundingClientRect().width;
    if (!scroller && w > de.clientWidth) add("table-no-scroll", `${Math.round(w)}px`);
  }

  return out;
};

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: MOBILE ? { width: 375, height: 812 } : { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error")
      consoleErrors.push(`${page.url().replace(BASE, "")}: ${m.text().slice(0, 120)}`);
  });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 20_000 });

  const byKind = new Map();
  for (const route of ROUTES) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 25_000 });
      await page.waitForTimeout(600);
      const result = await page.evaluate(AUDIT);
      for (const issue of result.issues) {
        if (!byKind.has(issue.kind)) byKind.set(issue.kind, []);
        byKind.get(issue.kind).push(`${route}  ${issue.detail}`);
      }
    } catch (error) {
      const list = byKind.get("page-failed") ?? [];
      list.push(`${route}  ${String(error).slice(0, 100)}`);
      byKind.set("page-failed", list);
    }
  }

  console.log(
    `\n=== ${MOBILE ? "MOBILE 375px" : "DESKTOP 1440px"} — ${ROUTES.length} routes ===\n`,
  );
  const order = [
    "page-failed",
    "no-accessible-name",
    "horizontal-scroll",
    "table-no-scroll",
    "img-no-alt",
    "no-h1",
    "heading-skip",
    "small-touch-target",
  ];
  for (const kind of order) {
    const rows = byKind.get(kind);
    if (!rows?.length) continue;
    console.log(`${kind} (${rows.length})`);
    for (const row of rows.slice(0, 14)) console.log("   " + row);
    if (rows.length > 14) console.log(`   ...and ${rows.length - 14} more`);
    console.log("");
  }
  if (consoleErrors.length) {
    console.log(`console-errors (${consoleErrors.length})`);
    for (const row of [...new Set(consoleErrors)].slice(0, 10)) console.log("   " + row);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
