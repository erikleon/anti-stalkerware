import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { removeTestDir } from "../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Covers the reachable slice of the OSINT screen: locked-state listing
 * with real gate eligibility for a real, imported sender. The unlocked
 * verify-mode flow (checking a candidate) isn't e2e-tested — reaching it
 * needs a sender whose message actually crosses the abuse threshold,
 * which needs the real ONNX classifier this environment doesn't have,
 * same disclosed gap as the rest of OSINT's unlocked state. That flow is
 * covered instead by test/unit/osint-verify.test.ts,
 * test/unit/osint-identifier-reuse.test.ts,
 * test/unit/osint-writing-style.test.ts, and
 * test/unit/vault/osint-verify-integration.test.ts (against a real
 * SqliteVaultStore with an explicit classification override, the same
 * way osint-gate-integration.test.ts sidesteps the same gap).
 *
 * Needs `npm run build` to have run first.
 */
test.describe("OSINT: locked state", () => {
  let userDataDir: string;
  let exportPath: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "docket-e2e-osint-"));
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

  test("a real imported sender shows up as not-yet-eligible, with Check disabled", async () => {
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
    await window.locator(".list-block-row").first().locator('input[type="checkbox"]').check();
    await window.getByRole("button", { name: /Add \d+ selected/ }).click();
    await window.getByRole("button", { name: "Back to settings" }).click();

    await window.locator('.app-nav a[aria-label="OSINT"]').click();
    await expect(window.locator("h1").first()).toHaveText("OSINT");
    const senderRow = window.locator(".list-block-row", { hasText: "+15551234567" });
    await expect(senderRow).toBeVisible();
    await expect(senderRow.getByText("Not eligible yet")).toBeVisible();
    await expect(senderRow.getByRole("button", { name: "Locked" })).toBeDisabled();

    await app.close();
  });
});
