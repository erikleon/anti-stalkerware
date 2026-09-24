import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * TODOS item 2's manual side: a "Lock now" action from Settings, real and
 * instant, independent of the inactivity timer (which is thoroughly unit-
 * tested via VaultSession.isIdle/touch with fake timers, and was verified
 * manually against the real running app — see the TODOS.md writeup for
 * why a real-time e2e test for the timer itself isn't worth a 60-100s
 * test run).
 *
 * Needs `npm run build` to have run first.
 */
test.describe("Lock now", () => {
  let userDataDir: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "docket-e2e-locknow-"));
  });

  test.afterEach(() => {
    removeTestDir(userDataDir);
  });

  test("locks immediately and shows why, and the same passphrase reopens it", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();
    await expect(window.locator(".bucket-rail")).toBeVisible();

    await window.locator('.app-nav a[aria-label="Settings"]').click();
    await window.getByRole("button", { name: "Lock now" }).click();

    await expect(window.locator("#pass")).toBeVisible();
    await expect(window.locator(".lock-screen-body")).toContainText("Enter your passphrase to continue");
    // Distinct from the auto-lock info message — this was a deliberate action, not a timeout.
    await expect(window.locator(".lock-screen-body")).not.toContainText("Locked after inactivity");

    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();
    await expect(window.locator(".bucket-rail")).toBeVisible();

    await app.close();
  });

  test("the auto-lock minutes setting persists across relaunch", async () => {
    const app1 = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window1 = await app1.firstWindow();
    await window1.locator("#pass").fill("correct horse battery staple");
    await window1.locator('button[type="submit"]').click();
    await window1.locator('.app-nav a[aria-label="Settings"]').click();

    const autoLockInput = window1.locator('input[type="number"]');
    await autoLockInput.fill("45");
    await autoLockInput.dispatchEvent("change");
    await window1.waitForTimeout(200); // lets the async settings write land before we close
    await app1.close();

    const app2 = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window2 = await app2.firstWindow();
    await window2.locator("#pass").fill("correct horse battery staple");
    await window2.locator('button[type="submit"]').click();
    await window2.locator('.app-nav a[aria-label="Settings"]').click();
    await expect(window2.locator('input[type="number"]')).toHaveValue("45");

    await app2.close();
  });
});
