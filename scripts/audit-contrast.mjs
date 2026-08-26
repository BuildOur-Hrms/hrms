import { chromium } from "playwright";

/**
 * Text contrast, measured in both themes.
 *
 * Dark mode is not an inversion of light mode, and a pair that passes in one
 * routinely fails in the other — so both are checked against the same WCAG
 * thresholds rather than one being assumed from the other.
 *
 *   node scripts/audit-contrast.mjs
 */

const BASE = process.env.AUDIT_URL ?? "http://localhost:3000";
const EMAIL = process.env.AUDIT_EMAIL ?? "hr@e2e.test";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "e2e-Password-1234";

const ROUTES = [
  "/dashboard",
  "/me/leave",
  "/me/attendance",
  "/me/tasks",
  "/hr/employees",
  "/hr/leave",
  "/hr/reports",
  "/admin/users",
  "/admin/audit-logs",
];

const CONTRAST = () => {
  // WCAG relative luminance.
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(Number);
    return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
  };
  // Walk up for the first non-transparent background.
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.5) return c.rgb;
      node = node.parentElement;
    }
    const root = parse(getComputedStyle(document.documentElement).backgroundColor);
    return root?.rgb ?? [255, 255, 255];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const seen = new Map();
  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length > 0) continue; // leaf text nodes only
    const text = el.textContent?.trim();
    if (!text || text.length < 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.5) continue;
    const fg = parse(cs.color);
    if (!fg) continue;

    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    // WCAG "large text": >=24px, or >=18.66px bold.
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;

    const got = ratio(fg.rgb, bgOf(el));
    if (got < need) {
      const key = `${cs.color}|${Math.round(size)}|${el.className}`;
      if (!seen.has(key)) {
        seen.set(key, {
          ratio: Math.round(got * 100) / 100,
          need,
          size: Math.round(size),
          sample: text.slice(0, 34),
          cls: String(el.className).split(" ").slice(0, 3).join(" "),
        });
      }
    }
  }
  return [...seen.values()];
};

async function main() {
  const browser = await chromium.launch();

  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
    });
    const page = await context.newPage();

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 20_000 });
    // The app remembers a theme choice; force the one under test.
    await page.evaluate((t) => localStorage.setItem("theme", t), theme);

    console.log(`\n=== ${theme.toUpperCase()} ===`);
    let total = 0;
    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 25_000 });
      await page.waitForTimeout(500);
      const rows = await page.evaluate(CONTRAST);
      if (!rows.length) continue;
      total += rows.length;
      console.log(`  ${route}`);
      for (const r of rows.slice(0, 5)) {
        console.log(`     ${r.ratio}:1 (needs ${r.need}) ${r.size}px  "${r.sample}"  .${r.cls}`);
      }
    }
    if (total === 0) console.log("  no text below the WCAG AA threshold");
    await context.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
