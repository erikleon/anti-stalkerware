import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bplist from "bplist-creator";
import { removeTestDir } from "../helpers/tmp-dir";

/**
 * Known accounts end to end: onboarding marks and pre-selects a sender
 * who is on the macOS block list, saves them as a known account, and the
 * OSINT screen lets the user add, relabel, import, and remove known
 * accounts. The block list is a fixture plist passed in through
 * DOCKET_MACOS_BLOCKLIST_PATH, never the real one of whoever runs this.
 *
 * Needs `npm run build` to have run first.
 */

const BLOCKED = "+15551234567";
const NOT_BLOCKED = "+15550001111";

async function unlockNewVault(window: Page): Promise<void> {
  await window.locator("#pass").fill("correct horse battery staple");
  await window.locator('button[type="submit"]').click();
}

test.describe("known accounts", () => {
  let userDataDir: string;
  let exportPath: string;
  let blocklistPath: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "docket-e2e-known-"));
    exportPath = join(userDataDir, "export.xml");
    writeFileSync(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="3">\n` +
        `<sms protocol="0" address="${BLOCKED}" date="1700000000000" type="1" body="you can't hide from me" />\n` +
        `<sms protocol="0" address="${BLOCKED}" date="1700000100000" type="1" body="answer me" />\n` +
        `<sms protocol="0" address="${NOT_BLOCKED}" date="1700000200000" type="1" body="lunch tomorrow?" />\n` +
        `</smses>`,
    );
    blocklistPath = join(userDataDir, "blocklist.plist");
    writeFileSync(
      blocklistPath,
      bplist({
        __kCMFBlockListStoreTopLevelKey: {
          __kCMFBlockListStoreArrayKey: [
            { __kCMFItemPhoneNumberUnformattedKey: BLOCKED, __kCMFItemTypeKey: 0 },
            { __kCMFItemEmailUnformattedKey: "other@example.com", __kCMFItemTypeKey: 1 },
            { __kCMFItemTypeKey: 2 },
          ],
        },
      }),
    );
  });

  test.afterEach(() => {
    removeTestDir(userDataDir);
  });

  test("onboarding pre-selects a blocked sender and saves them as a known account", async () => {
    test.skip(process.platform !== "darwin", "the block list is a macOS-only source");
    const app = await electron.launch({
      args: [".", `--user-data-dir=${userDataDir}`],
      env: { ...process.env, DOCKET_MACOS_BLOCKLIST_PATH: blocklistPath },
    });
    const window = await app.firstWindow();
    await unlockNewVault(window);

    await window.locator('.app-nav a[aria-label="Settings"]').click();
    await window.locator(".list-block-row", { hasText: "Android SMS export" }).getByRole("button", { name: "Connect" }).click();
    await window.locator('input[type="text"]').first().fill(exportPath);
    await window.getByRole("button", { name: "Scan" }).click();

    await expect(window.getByText(/1 is on your block list on this Mac/)).toBeVisible();
    await expect(window.getByText(/1 other blocked contact has no messages here/)).toBeVisible();
    await window.getByRole("button", { name: "I'm ready" }).click();

    const rows = window.locator(".list-block-row");
    await expect(rows.first()).toContainText(BLOCKED);
    await expect(rows.first()).toContainText("Blocked on this Mac");
    await expect(rows.first().locator('input[type="checkbox"]')).toBeChecked();
    await expect(window.locator(".list-block-row", { hasText: NOT_BLOCKED }).locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(window.getByText(/Also save the blocked senders I selected/)).toBeVisible();

    await window.getByRole("button", { name: "Add 1 selected" }).click();
    await expect(window.getByText("Saved 1 blocked sender as known accounts.", { exact: false })).toBeVisible();
    await window.getByRole("button", { name: "Back to settings" }).click();

    await window.locator('.app-nav a[aria-label="OSINT"]').click();
    const knownRow = window.locator(".list-block-row", { hasText: "Blocked on this Mac" });
    await expect(knownRow).toContainText(BLOCKED);

    await window.getByRole("button", { name: "Import contacts I blocked on this Mac" }).click();
    await expect(window.getByText(/Added 1 blocked contact \(1 already known\)/)).toBeVisible();
    await expect(window.getByText(/1 entry couldn't be read/)).toBeVisible();
    await expect(window.locator(".list-block-row", { hasText: "other@example.com" })).toBeVisible();

    await app.close();
  });

  test("known accounts can be added, grouped under one person, and removed", async () => {
    const app = await electron.launch({
      args: [".", `--user-data-dir=${userDataDir}`],
      env: { ...process.env, DOCKET_MACOS_BLOCKLIST_PATH: blocklistPath },
    });
    const window = await app.firstWindow();
    await unlockNewVault(window);

    await window.locator('.app-nav a[aria-label="OSINT"]').click();
    await expect(window.getByText("No known accounts yet.", { exact: false })).toBeVisible();

    const addBtn = window.getByRole("button", { name: "Add known account" });
    await expect(addBtn).toBeDisabled();
    await window.getByPlaceholder("e.g. my ex").fill("my ex");
    await window.getByLabel("Account type").selectOption("phone");
    await window.getByLabel("Number, email, or username").fill("(555) 123-4567");
    await addBtn.click();

    const phoneRow = window.locator(".list-block-row", { hasText: "(555) 123-4567" });
    await expect(phoneRow).toContainText("Added by you");
    await expect(phoneRow.getByLabel("Person for (555) 123-4567")).toHaveValue("my ex");

    // The same number in another format is the same account, not a second row.
    await window.getByPlaceholder("e.g. my ex").fill("someone else");
    await window.getByLabel("Number, email, or username").fill("+15551234567");
    await window.getByRole("button", { name: "Add known account" }).click();
    await expect(window.locator(".list-block-row", { hasText: "Phone" })).toHaveCount(1);

    await phoneRow.getByLabel("Person for (555) 123-4567").fill("my ex (old number)");
    await phoneRow.getByLabel("Person for (555) 123-4567").press("Enter");
    await expect(window.locator(".list-block-row", { hasText: "(555) 123-4567" }).getByLabel("Person for (555) 123-4567")).toHaveValue(
      "my ex (old number)",
    );

    await window.locator(".list-block-row", { hasText: "(555) 123-4567" }).getByRole("button", { name: "Remove" }).click();
    await expect(window.getByText("No known accounts yet.", { exact: false })).toBeVisible();

    await app.close();
  });
});
