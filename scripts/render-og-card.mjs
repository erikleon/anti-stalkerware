// Renders scripts/og-card.html to docs/og-image.png (1200×630), the image
// link previews show when someone shares the site. Run after
// scripts/capture-screenshots.mjs, since the card embeds the triage shot.
//
//   node scripts/render-og-card.mjs
//
// Needs Playwright's Chromium (`npx playwright install chromium`), or set
// PLAYWRIGHT_CHROMIUM_PATH to any other Chromium/Chrome binary.
import { chromium } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_PATH"];
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(root, "scripts", "og-card.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, "docs", "og-image.png") });
await browser.close();
console.log("wrote docs/og-image.png");
