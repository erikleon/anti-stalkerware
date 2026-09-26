import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../helpers/tmp-dir";

/**
 * The OSINT online checks up to the point where they'd use the network:
 * the offline link check, the disclosures, and the username field. The
 * requests themselves aren't made here, so CI never depends on third-party
 * sites; test/unit/osint-network.test.ts covers them with a fake network.
 *
 * Needs `npm run build` to have run first.
 */
test("online checks show offline link warnings and say what they'd contact before running", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "docket-e2e-osint-online-"));
  try {
    const exportPath = join(userDataDir, "export.xml");
    const bodies = ["I will kill you if you ever leave me", "look what I found about you grabify.link/ABC123", "follow my new account @new_acct_2"];
    writeFileSync(
      exportPath,
      `<?xml version="1.0"?><smses>${bodies.map((b, i) => `<sms address="+15551234567" date="${1700000000000 + i}" type="1" body="${b}" />`).join("")}</smses>`,
    );
    const app = await electron.launch({
      args: [".", `--user-data-dir=${userDataDir}`],
      env: { ...process.env, DOCKET_MACOS_BLOCKLIST_PATH: join(userDataDir, "no-blocklist.plist") },
    });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();
    await window.locator(".app-nav").waitFor();
    await window.evaluate((path) => (globalThis as unknown as { docket: { onboarding: { connectAndroidSms(p: string, ids: string[]): Promise<unknown> } } }).docket.onboarding.connectAndroidSms(path, ["+15551234567"]), exportPath);

    await window.locator('.app-nav a[aria-label="OSINT"]').click();
    // The model scores the import in the background; the gate opens once it has.
    await expect(async () => {
      await window.locator('.app-nav a[aria-label="Triage"]').click();
      await window.locator('.app-nav a[aria-label="OSINT"]').click();
      await expect(window.locator(".list-block-row", { hasText: "+15551234567" }).getByRole("button", { name: "Check" })).toBeEnabled({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await window.locator(".list-block-row", { hasText: "+15551234567" }).getByRole("button", { name: "Check" }).click();

    const linkRow = window.locator(".list-block-row", { hasText: "grabify.link/ABC123" });
    await expect(linkRow.locator(".badge", { hasText: "IP logger" })).toBeVisible();
    await expect(linkRow).toContainText("Listed by: built-in list.");
    await expect(window.getByText("The links themselves aren't sent anywhere.", { exact: false })).toBeVisible();
    await expect(window.getByRole("button", { name: "Check against public threat lists" })).toBeEnabled();

    const handle = window.getByLabel("Username", { exact: true });
    await expect(handle).toHaveValue("new_acct_2");

    // Default tier: named sites, and the major platforms whose rules failed testing named too.
    const major = window.getByRole("button", { name: /Check \d+ major platforms/ });
    await expect(major).toBeEnabled();
    const majorNotice = window.locator(".network-notice", { hasText: "each of them can see your IP address" });
    await expect(majorNotice).toContainText("GitHub (User)");
    await expect(window.getByText("Not checked, because their rules didn't pass docket's testing: Instagram", { exact: false })).toBeVisible();

    // The sweep: a count, and the sensitive-category checkbox raises it.
    const sweep = window.getByRole("button", { name: /Check all \d+ sites/ });
    const before = Number((await sweep.textContent())!.match(/\d+/)![0]);
    await window.getByLabel(/Also check dating, adult, health, and political sites/).check();
    const after = Number((await sweep.textContent())!.match(/\d+/)![0]);
    expect(after).toBeGreaterThan(before);

    await expect(window.getByText(/Site rules: WhatsMyName .* CC BY-SA 4\.0, commit [0-9a-f]{7}/)).toBeVisible();

    await handle.fill("not a handle!");
    await expect(major).toBeDisabled();
    await expect(sweep).toBeDisabled();

    await app.close();
  } finally {
    removeTestDir(userDataDir);
  }
});
