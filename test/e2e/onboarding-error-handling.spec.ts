import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Found during a /qa pass: a bad chat.db path surfaced Electron's raw IPC
 * wrapper text ("Error invoking remote method 'onboarding:sweepImessage':
 * TypeError: ...") straight to the user instead of a readable message.
 * Fixed with renderer/dom.ts's ipcErrorMessage(); this locks it down from
 * the outside, since that helper can't be unit-tested directly (it lives
 * in renderer/, which needs the DOM lib test/unit's shared tsconfig
 * doesn't have — see the commit this test shipped with).
 *
 * Needs `npm run build` to have run first.
 */
test.describe("onboarding: error handling", () => {
  let userDataDir: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "antistalker-e2e-onboarding-errors-"));
  });

  test.afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test("a bad chat.db path shows a readable error, not Electron's IPC wrapper text", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    await window.locator('.app-nav a[aria-label="Settings"]').click();
    const imessageRow = window.locator(".list-block-row", { hasText: "iMessage" });
    await imessageRow.getByRole("button", { name: "Connect" }).click();
    await window.locator('input[type="text"]').first().fill("/nonexistent/path/chat.db");
    await window.getByRole("button", { name: "Scan" }).click();

    const errorText = window.locator(".content-pane p").last();
    await expect(errorText).not.toContainText("Error invoking remote method");
    await expect(errorText).not.toContainText("TypeError");
    await expect(errorText).toContainText("directory does not exist");

    // The form stays usable — this isn't a dead end.
    await expect(window.getByRole("button", { name: "Scan" })).toBeVisible();

    await app.close();
  });
});
