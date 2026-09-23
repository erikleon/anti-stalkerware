import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * TODOS item 7: authoring a tagged phrase actually changes triage banding,
 * end to end through the real UI. Also locks down a real CSS bug this
 * feature surfaced: .list-block collapsed to 0 height (per the flexbox
 * automatic-minimum-size rule for items with non-visible overflow) whenever
 * it held content sized only by that content, silently swallowing clicks
 * on rows inside it — including, notably, the Remove buttons this test
 * exercises. A DOM text query wouldn't have caught it; only an actual
 * click does.
 *
 * Needs `npm run build` to have run first.
 */
test.describe("boundaries and tagged phrases", () => {
  let userDataDir: string;
  let exportPath: string;

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), "antistalker-e2e-boundaries-"));
    exportPath = join(userDataDir, "export.xml");
    writeFileSync(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="1">\n` +
        `<sms protocol="0" address="+15551234567" date="1700000000000" type="1" body="hey remember peaches from back then" />\n` +
        `</smses>`,
    );

    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();
    await window.locator('.app-nav a[aria-label="Settings"]').click();
    const androidRow = window.locator(".list-block-row", { hasText: "Android SMS export" });
    await androidRow.getByRole("button", { name: "Connect" }).click();
    await window.locator('input[type="text"]').first().fill(exportPath);
    await window.getByRole("button", { name: "Scan" }).click();
    await window.getByRole("button", { name: "I'm ready" }).click();
    await window.locator(".list-block-row input[type=checkbox]").nth(0).check();
    await window.getByRole("button", { name: /Add 1 selected/ }).click();
    await window.getByRole("button", { name: "Back to settings" }).click();
    await app.close();
  });

  test.afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test("a tagged phrase bumps the thread to Medium with a visible reason, and removing it undoes that", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    // Before tagging: no badge at all.
    await expect(window.locator(".badge")).toHaveCount(0);

    await window.locator('.app-nav a[aria-label="Settings"]').click();
    await window.getByText("Boundaries & tagged phrases").click();
    await expect(window.locator("h1").first()).toHaveText("Boundaries & tagged phrases");

    await window.locator('input[placeholder="A phrase, nickname, or reference"]').fill("peaches");
    await window.locator('input[placeholder="Why it matters"]').fill("our old nickname, only they'd use it");
    await window.getByRole("button", { name: "Add tagged phrase" }).click();
    await expect(window.locator(".list-block-row-title")).toHaveText("peaches");

    await window.locator('.app-nav a[aria-label="Triage"]').click();
    await expect(window.locator(".badge")).toHaveText("Medium");
    await expect(window.locator(".message-row-signal")).toContainText("peaches");

    // Remove it and confirm the signal (and its effect on the band) goes away.
    await window.locator('.app-nav a[aria-label="Settings"]').click();
    await window.getByText("Boundaries & tagged phrases").click();
    await window.locator(".list-block-row", { hasText: "peaches" }).getByRole("button", { name: "Remove" }).click();
    await expect(window.locator(".list-block-row-title")).toHaveCount(0);

    await window.locator('.app-nav a[aria-label="Triage"]').click();
    await expect(window.locator(".badge")).toHaveCount(0);

    await app.close();
  });

  test("a boundary can be added and removed through the real form", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    await window.locator('.app-nav a[aria-label="Settings"]').click();
    await window.getByText("Boundaries & tagged phrases").click();

    await window.locator('input[placeholder="e.g. told them to stop contacting me"]').fill("told them to stop contacting me");
    await window.getByRole("button", { name: "Add boundary" }).click();
    await expect(window.locator(".list-block-row-title").first()).toHaveText("told them to stop contacting me");

    await window.locator(".list-block-row", { hasText: "told them to stop" }).getByRole("button", { name: "Remove" }).click();
    await expect(window.getByText("No boundaries recorded yet.")).toBeVisible();

    await app.close();
  });
});
