import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { removeTestDir } from "../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Two features designed (DESIGN.md's Motion section specs a "blur
 * reveal/hide" transition, and the locked mockup — ColorwayC.dc.html —
 * has per-row checkboxes and a batch action bar) but never actually built
 * in the real triage screen. Found via a /qa pass against the running
 * dev instance and implemented here.
 *
 * Needs `npm run build` to have run first.
 */
test.describe("triage: blur toggle and batch selection", () => {
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), "antistalker-e2e-blur-batch-"));
    const exportPath = join(userDataDir, "export.xml");
    writeFileSync(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="2">\n` +
        `<sms protocol="0" address="+15551111111" date="1700000000000" type="1" body="message one preview text" />\n` +
        `<sms protocol="0" address="+15552222222" date="1700001000000" type="1" body="message two preview text" />\n` +
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

  test("previews are blurred by default and the toggle reveals them", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    const blurCheckbox = window.locator(".message-list-header input[type=checkbox]");
    await expect(blurCheckbox).toBeChecked();
    await expect(window.locator(".message-row-preview").first()).toHaveClass(/is-blurred/);

    await blurCheckbox.uncheck();
    await expect(window.locator(".message-row-preview").first()).not.toHaveClass(/is-blurred/);

    await app.close();
  });

  test("the row list never scrolls horizontally, blurred or not", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    const overflow = await window.locator(".message-list-rows").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBe(0);

    await app.close();
  });

  test("selecting rows shows the batch bar, and batch hide moves both out of Needs review", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    await expect(window.locator(".batch-bar")).toHaveClass(/is-hidden/);

    await window.locator(".message-row-select").nth(0).check();
    await expect(window.locator(".batch-bar")).not.toHaveClass(/is-hidden/);
    await expect(window.locator(".batch-bar span").first()).toHaveText("1 selected");

    await window.locator(".message-row-select").nth(1).check();
    await expect(window.locator(".batch-bar span").first()).toHaveText("2 selected");

    await window.locator(".batch-bar").getByRole("button", { name: "Clear" }).click();
    await expect(window.locator(".batch-bar")).toHaveClass(/is-hidden/);
    await expect(window.locator(".message-row-select").nth(0)).not.toBeChecked();

    await window.locator(".message-row-select").nth(0).check();
    await window.locator(".message-row-select").nth(1).check();
    await window.locator(".batch-bar").getByRole("button", { name: "Hide" }).click();

    await expect(window.locator(".message-row")).toHaveCount(0);
    await expect(window.locator(".bucket-item .count").first()).toHaveText("0");

    // Hide is a view-state flag, not a delete — both threads still show under All.
    await window.locator(".bucket-item", { hasText: "All" }).click();
    await expect(window.locator(".message-row")).toHaveCount(2);

    await app.close();
  });
});
