import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/**
 * Renders `docs/changelog.html` to `docs/HRMS-Changelog.pdf`.
 *
 * Chromium rather than a PDF library because the document is already styled
 * for print — `@page`, page-break rules, real table layout — and a browser is
 * the only thing that reads those the way a printer would. Playwright is
 * already a dependency for the browser journeys, so this adds nothing.
 *
 *   npx tsx scripts/build-changelog-pdf.ts
 */

const SOURCE = resolve(process.cwd(), "docs/changelog.html");
const OUTPUT = resolve(process.cwd(), "docs/HRMS-Changelog.pdf");

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(SOURCE).href, { waitUntil: "networkidle" });

    await page.pdf({
      path: OUTPUT,
      format: "A4",
      // The margins live in the stylesheet's `@page` rule, so that the HTML
      // and the PDF agree about the page rather than each having a view.
      preferCSSPageSize: true,
      printBackground: true,
    });

    console.log(`Wrote ${OUTPUT}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
