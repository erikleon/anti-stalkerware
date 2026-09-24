import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { removeTestDir } from "../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Drives the Android SMS onboarding wizard end to end against the real
 * compiled app: connect -> scan -> before-you-continue -> select -> import
 * -> back to Settings showing "Connected" -> the imported message actually
 * shows up in triage. Android SMS is the only source onboarding can be
 * fully tested against without a live macOS chat.db or a real IMAP
 * account — its export is just a file, no external dependency.
 *
 * Needs `npm run build` to have run first.
 */
test.describe("onboarding: connect an Android SMS export", () => {
  let userDataDir: string;
  let exportPath: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "antistalker-e2e-onboarding-"));
    exportPath = join(userDataDir, "export.xml");
    writeFileSync(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="1">\n` +
        `<sms protocol="0" address="+15551234567" date="1700000000000" type="1" body="you can't hide from me" />\n` +
        `</smses>`,
    );
  });

  test.afterEach(() => {
    removeTestDir(userDataDir);
  });

  test("connecting imports the selected sender's messages into triage", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();

    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();
    await expect(window.locator(".bucket-rail")).toBeVisible();

    await window.locator('.app-nav a[aria-label="Settings"]').click();
    const androidRow = window.locator(".list-block-row", { hasText: "Android SMS export" });
    await androidRow.getByRole("button", { name: "Connect" }).click();

    await expect(window.locator(".content-pane h1")).toHaveText("Connect Android SMS export");
    await window.locator('input[type="text"]').first().fill(exportPath);
    await window.getByRole("button", { name: "Scan" }).click();

    await expect(window.locator(".content-pane h1")).toHaveText("Before you continue");
    await window.getByRole("button", { name: "I'm ready" }).click();

    await expect(window.locator(".content-pane h1")).toHaveText("Choose who to include");
    await expect(window.locator(".list-block-row-title")).toHaveText("+15551234567");
    await window.locator(".list-block-row input[type=checkbox]").first().check();
    await window.getByRole("button", { name: "Add 1 selected" }).click();

    await expect(window.locator(".content-pane h1")).toHaveText("Connected");
    await expect(window.locator(".empty-state")).toHaveText("Imported 1 message.");
    await window.getByRole("button", { name: "Back to settings" }).click();

    await expect(androidRow).toContainText("Connected");

    await window.locator('.app-nav a[aria-label="Triage"]').click();
    await expect(window.locator(".message-row-preview")).toHaveText("you can't hide from me");

    await app.close();
  });
});
