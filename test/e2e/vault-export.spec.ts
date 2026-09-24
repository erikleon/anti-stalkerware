import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * No e2e coverage existed for this screen before — caught during a /qa
 * pass when a triage-only CSS change (.message-row's flex-direction)
 * silently broke this screen's row layout, since it reuses the same
 * class without triage's checkbox/content-wrapper structure.
 *
 * Needs `npm run build` to have run first.
 */
test.describe("Vault and export", () => {
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), "antistalker-e2e-vault-export-"));
    const exportPath = join(userDataDir, "export.xml");
    writeFileSync(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="2">\n` +
        `<sms protocol="0" address="+15551111111" date="1700000000000" type="1" body="findable by search term zebra" />\n` +
        `<sms protocol="0" address="+15552222222" date="1700001000000" type="1" body="a different message entirely" />\n` +
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
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test("lists every vault message with no horizontal overflow, and search filters it", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();
    await window.locator('.app-nav a[aria-label="Vault and export"]').click();

    await expect(window.locator(".message-row")).toHaveCount(2);
    const overflow = await window.locator(".message-list").first().evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBe(0);

    await window.locator('input[placeholder="Search vault messages"]').fill("zebra");
    await expect(window.locator(".message-row")).toHaveCount(1);
    await expect(window.locator(".message-row-preview")).toContainText("zebra");

    await window.locator('input[placeholder="Search vault messages"]').fill("nothing matches this");
    await expect(window.getByText("No messages match.")).toBeVisible();

    await app.close();
  });
});
