import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { removeTestDir } from "../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Keyboard power-navigation (TODOS item 4) against real triage rows seeded
 * through onboarding — also closes the remaining gap TODOS item 8 called
 * out: mark reviewed / hide against a real message, and bucket counts
 * updating, weren't covered by any e2e test yet.
 *
 * Needs `npm run build` to have run first.
 */
test.describe("triage: keyboard power-navigation", () => {
  let userDataDir: string;
  let exportPath: string;

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), "docket-e2e-kbnav-"));
    exportPath = join(userDataDir, "export.xml");
    writeFileSync(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="2">\n` +
        `<sms protocol="0" address="+15551111111" date="1700000000000" type="1" body="message one" />\n` +
        `<sms protocol="0" address="+15552222222" date="1700001000000" type="1" body="message two" />\n` +
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
    await window.locator(".list-block-row input[type=checkbox]").nth(1).check();
    await window.getByRole("button", { name: /Add 2 selected/ }).click();
    await window.getByRole("button", { name: "Back to settings" }).click();
    await app.close();
  });

  test.afterEach(() => {
    removeTestDir(userDataDir);
  });

  test("arrow keys move a roving focus, Enter opens, r marks reviewed and updates counts", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();
    await expect(window.locator(".message-row")).toHaveCount(2);
    await expect(window.locator(".bucket-item .count").first()).toHaveText("2");

    const rowButtons = window.locator(".message-row-open");
    const firstOpenButton = rowButtons.nth(0);
    const secondOpenButton = rowButtons.nth(1);

    await firstOpenButton.focus();
    await expect(firstOpenButton).toBeFocused();
    await expect(firstOpenButton).toHaveAttribute("aria-label", /\+15552222222/); // most recent message first

    await firstOpenButton.press("ArrowDown");
    await expect(secondOpenButton).toBeFocused();
    await expect(secondOpenButton).toHaveAttribute("aria-label", /\+15551111111/);

    // Enter opens the focused row (native <button> behavior).
    await window.keyboard.press("Enter");
    await expect(window.locator(".detail-message-text")).toHaveText("message one");

    // r marks the focused row reviewed: it leaves Needs review, and the count follows.
    await window.keyboard.press("r");
    await expect(window.locator(".bucket-item .count").first()).toHaveText("1");
    await expect(window.locator(".message-row")).toHaveCount(1);

    await app.close();
  });

  test("h hides the focused row out of Needs review", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    await window.locator(".message-row-open").first().focus();
    await window.keyboard.press("h");
    await expect(window.locator(".bucket-item .count").first()).toHaveText("1");
    await expect(window.locator(".message-row")).toHaveCount(1);

    // Hidden threads still show up under "All" — hide is a view-state
    // flag, not a delete (see vault/triage-state.ts).
    await window.locator(".bucket-item", { hasText: "All" }).click();
    await expect(window.locator(".message-row")).toHaveCount(2);

    await app.close();
  });
});
