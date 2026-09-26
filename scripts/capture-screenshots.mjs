// Captures the README and marketing-site screenshots from the real, built
// app, using a throwaway vault filled with made-up demo data. Nothing here
// touches a real vault or the real macOS block list.
//
//   npm run build && node scripts/capture-screenshots.mjs
//
// Every band and reason in these screenshots comes from the app itself,
// including the shipped toxicity model scoring the demo messages.
import { _electron as electron } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bplist from "bplist-creator";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "screenshots");
mkdirSync(outDir, { recursive: true });

const PASSPHRASE = "demo passphrase for screenshots";
const OLD_NUMBER = "+15551234567";
const NEW_NUMBER = "+15559990000";
const COPARENT = "+15554443333";
const COWORKER = "+15552228888";

const day = (iso) => Date.parse(iso);
const sms = (address, iso, body, fromSelf = false) =>
  `<sms protocol="0" address="${address}" date="${day(iso)}" type="${fromSelf ? 2 : 1}" body="${body.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")}" />`;

const messages = [
  sms(OLD_NUMBER, "2024-02-02T21:14:00Z", "why aren't you answering me. i actually just want to talk because you really owe me that much after everything"),
  sms(OLD_NUMBER, "2024-02-03T02:40:00Z", "i know you're reading these. you can't hide from me forever, i will find out where you are staying"),
  sms(OLD_NUMBER, "2024-02-05T23:05:00Z", "fine. but you should really think about what you are doing to this family because i am not going away"),
  sms(OLD_NUMBER, "2024-02-06T01:10:00Z", "Please stop contacting me. Only message me about pickup times.", true),
  sms(NEW_NUMBER, "2024-04-11T22:31:00Z", "hey it's me. you really thought blocking 555-123-4567 would actually change anything"),
  sms(NEW_NUMBER, "2024-04-12T03:02:00Z", "i am not going away and you should really just answer me because like i actually know where you are staying now"),
  sms(NEW_NUMBER, "2024-04-12T03:09:00Z", "you can't hide from me. answer the phone or I will hurt you"),
  sms(COPARENT, "2024-04-10T16:20:00Z", "Pickup is at 5:30 on Friday. I'll bring her backpack and the permission slip."),
  sms(COPARENT, "2024-04-10T16:45:00Z", "Thanks, 5:30 works.", true),
  sms(COWORKER, "2024-04-09T14:02:00Z", "did you get the slides for tomorrow's meeting?"),
];

const dir = mkdtempSync(join(tmpdir(), "docket-screenshots-"));
const exportPath = join(dir, "sms-backup.xml");
writeFileSync(exportPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="${messages.length}">\n${messages.join("\n")}\n</smses>`);
const blocklistPath = join(dir, "blocklist.plist");
writeFileSync(
  blocklistPath,
  bplist({ __kCMFBlockListStoreTopLevelKey: { __kCMFBlockListStoreArrayKey: [{ __kCMFItemPhoneNumberUnformattedKey: OLD_NUMBER }] } }),
);

const env = { ...process.env, DOCKET_MACOS_BLOCKLIST_PATH: blocklistPath };
const launchArgs = [".", `--user-data-dir=${dir}`, "--force-device-scale-factor=2"];

async function open() {
  const app = await electron.launch({ cwd: root, args: launchArgs, env });
  const window = await app.firstWindow();
  await window.emulateMedia({ colorScheme: "dark" });
  await window.setViewportSize({ width: 1280, height: 800 });
  await window.locator("#pass").fill(PASSPHRASE);
  await window.locator('button[type="submit"]').click();
  await window.locator(".app-nav").waitFor();
  return { app, window };
}

async function shot(window, name) {
  // Park the pointer so no button is caught mid-hover.
  await window.mouse.move(1279, 799);
  await window.waitForTimeout(250);
  await window.screenshot({ path: join(outDir, `${name}.png`) });
  console.log(`wrote docs/screenshots/${name}.png`);
}

// Session 1: boundaries, then onboarding with the block list.
{
  const { app, window } = await open();
  await window.evaluate(
    async ([sender]) => {
      await window.docket.userContext.addBoundary("Told them to only message me about pickup times", "2024-02-06", sender);
      await window.docket.userContext.addTaggedPhrase("can't hide", "Said the same thing right before I moved");
    },
    [NEW_NUMBER],
  );

  await window.locator('.app-nav a[aria-label="Settings"]').click();
  await window.locator(".list-block-row", { hasText: "Android SMS export" }).getByRole("button", { name: "Connect" }).click();
  await window.locator('input[type="text"]').first().fill(exportPath);
  await window.getByRole("button", { name: "Scan" }).click();
  await window.getByRole("button", { name: "I'm ready" }).click();
  await window.locator(".list-block-row", { hasText: NEW_NUMBER }).locator('input[type="checkbox"]').check();
  await window.locator(".list-block-row", { hasText: COPARENT }).locator('input[type="checkbox"]').check();
  await shot(window, "onboarding-blocked");
  await window.getByRole("button", { name: /Add \d+ selected/ }).click();
  await window.getByRole("button", { name: "Back to settings" }).click();
  await app.close();
}

// Session 2: triage, OSINT, vault. The model scores the import in the
// background after unlock; wait for it before capturing.
{
  const { app, window } = await open();
  await window.waitForFunction(async () => (await window.docket.scoring.status()).state === "ready", undefined, { timeout: 30_000 });

  await window.locator(".message-row", { hasText: NEW_NUMBER }).first().click();
  await shot(window, "triage");

  await window.locator('.app-nav a[aria-label="OSINT"]').click();
  const person = window.getByLabel(`Person for ${OLD_NUMBER}`);
  await person.fill("Jordan");
  await person.press("Enter");
  await window.locator(".list-block-row", { hasText: NEW_NUMBER }).getByRole("button", { name: "Check" }).click();
  await window.getByRole("button", { name: "Compare" }).click();
  await window.getByText("supporting signal", { exact: false }).first().waitFor();
  await shot(window, "osint-compare");

  await window.locator('.app-nav a[aria-label="Vault and export"]').click();
  await shot(window, "vault");
  await app.close();
}

rmSync(dir, { recursive: true, force: true });
