import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../helpers/tmp-dir";
import { writeInstagramExport } from "../helpers/instagram-export";

/**
 * Connecting an Instagram export: the sender whose thread folder matches
 * a username on the export's own block list is marked and pre-selected,
 * the whole Instagram block list can be saved as known accounts, and the
 * imported messages show up in triage.
 *
 * Needs `npm run build` to have run first.
 */
test.describe("onboarding: Instagram export", () => {
  let userDataDir: string;
  let exportDir: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "docket-e2e-instagram-"));
    exportDir = join(userDataDir, "instagram-export");
    writeInstagramExport(exportDir, {
      owner: "Me Here",
      threads: [
        {
          folder: "alexb_old_111",
          participants: ["Alex B", "Me Here"],
          messages: [{ sender_name: "Alex B", timestamp_ms: 1_700_000_000_000, content: "you can’t block me forever" }],
        },
        {
          folder: "sam_222",
          participants: ["Sam", "Me Here"],
          messages: [{ sender_name: "Sam", timestamp_ms: 1_700_000_100_000, content: "see you at practice" }],
        },
      ],
      blocked: {
        relationships_blocked_users: [
          { title: "alexb_old", string_list_data: [{ href: "https://www.instagram.com/alexb_old" }] },
          { title: "spam_bot_9", string_list_data: [{ href: "https://www.instagram.com/spam_bot_9" }] },
        ],
      },
    });
  });

  test.afterEach(() => {
    removeTestDir(userDataDir);
  });

  test("marks the blocked sender, saves the block list, and imports into triage", async () => {
    const app = await electron.launch({
      args: [".", `--user-data-dir=${userDataDir}`],
      // Keep the real macOS block list out of this test.
      env: { ...process.env, DOCKET_MACOS_BLOCKLIST_PATH: join(userDataDir, "no-blocklist.plist") },
    });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    await window.locator('.app-nav a[aria-label="Settings"]').click();
    await window.locator(".list-block-row", { hasText: "Instagram export" }).getByRole("button", { name: "Connect" }).click();
    await expect(window.getByRole("button", { name: "Choose folder…" })).toBeVisible();
    await window.locator('input[type="text"]').first().fill(exportDir);
    await window.getByRole("button", { name: "Scan" }).click();

    await expect(window.getByText(/1 is blocked on Instagram/)).toBeVisible();
    await expect(window.getByText(/You blocked 1 other account on Instagram/)).toBeVisible();
    await window.getByRole("button", { name: "I'm ready" }).click();

    const alexRow = window.locator(".list-block-row", { hasText: "Alex B" });
    await expect(alexRow).toContainText("Blocked on Instagram");
    await expect(alexRow.locator('input[type="checkbox"]')).toBeChecked();
    await expect(window.locator(".list-block-row", { hasText: "Sam" }).locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(window.getByText(/Also save the 2 accounts I blocked on Instagram/)).toBeVisible();

    await window.getByRole("button", { name: "Add 1 selected" }).click();
    await expect(window.getByText("Imported 1 message.")).toBeVisible();
    await expect(window.getByText(/Saved 2 blocked accounts as known accounts/)).toBeVisible();
    await window.getByRole("button", { name: "Back to settings" }).click();
    await expect(window.locator(".list-block-row", { hasText: "Instagram export" })).toContainText("Connected");

    await window.locator('.app-nav a[aria-label="OSINT"]').click();
    await expect(window.locator(".list-block-row", { hasText: "alexb_old" })).toContainText("Blocked on Instagram");
    await expect(window.locator(".list-block-row", { hasText: "spam_bot_9" })).toBeVisible();

    await app.close();
  });
});
