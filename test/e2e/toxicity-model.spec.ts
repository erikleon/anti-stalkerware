import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../helpers/tmp-dir";

/**
 * The shipped toxicity model end to end, with nothing set by hand: an
 * imported threat is scored in the background, shows as High in triage
 * with the model's reason, and opens the OSINT gate for that sender. A
 * friend's swearing in the same import does not.
 *
 * Needs `npm run build` to have run first (which fetches the model).
 */
test.describe("toxicity model", () => {
  let userDataDir: string;
  let exportPath: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "docket-e2e-model-"));
    exportPath = join(userDataDir, "export.xml");
    writeFileSync(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="3">\n` +
        `<sms protocol="0" address="+15551234567" date="1700000000000" type="1" body="I will kill you if you ever leave me" />\n` +
        `<sms protocol="0" address="+15552228888" date="1700000100000" type="1" body="lol fuck yes, see you there" />\n` +
        `<sms protocol="0" address="+15554443333" date="1700000200000" type="1" body="Pickup is at 5:30 on Friday." />\n` +
        `</smses>`,
    );
  });

  test.afterEach(() => {
    removeTestDir(userDataDir);
  });

  test("an imported threat is flagged High with a reason, and opens OSINT for that sender only", async () => {
    const app = await electron.launch({
      args: [".", `--user-data-dir=${userDataDir}`],
      env: { ...process.env, DOCKET_MACOS_BLOCKLIST_PATH: join(userDataDir, "no-blocklist.plist") },
    });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    await window.locator('.app-nav a[aria-label="Settings"]').click();
    await window.locator(".list-block-row", { hasText: "Android SMS export" }).getByRole("button", { name: "Connect" }).click();
    await window.locator('input[type="text"]').first().fill(exportPath);
    await window.getByRole("button", { name: "Scan" }).click();
    await window.getByRole("button", { name: "I'm ready" }).click();
    await window.getByText("Select all").click();
    await window.getByRole("button", { name: "Add 3 selected" }).click();
    await window.getByRole("button", { name: "Back to settings" }).click();

    await expect(window.locator("#scoring-status")).toHaveText(/Scored 3 messages; 1 crossed the abuse threshold\.|Up to date/, { timeout: 15_000 });

    await window.locator('.app-nav a[aria-label="Triage"]').click();
    const threatRow = window.locator(".message-row", { hasText: "+15551234567" });
    await expect(threatRow.locator(".badge--high")).toBeVisible();
    await expect(threatRow).toContainText("Toxicity model: reads as a threat");
    // The friend's swearing gets no model reason and isn't High. (It is
    // Medium here from a different, structural signal: its first message
    // arrives within 72 hours of a known-abusive sender's, the "new number"
    // pattern. That signal is separate from the model.)
    const friendRow = window.locator(".message-row", { hasText: "+15552228888" });
    await expect(friendRow).not.toContainText("Toxicity model");
    await expect(friendRow.locator(".badge--high")).toHaveCount(0);

    await window.locator('.app-nav a[aria-label="OSINT"]').click();
    const eligible = window.locator(".list-block-row", { hasText: "+15551234567" });
    await expect(eligible).toContainText("Crossed the abuse threshold");
    await expect(eligible.getByRole("button", { name: "Check" })).toBeEnabled();
    await expect(window.locator(".list-block-row", { hasText: "+15552228888" })).toContainText("Not eligible yet");

    await app.close();
  });
});
