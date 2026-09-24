import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A real launch of the packaged app: main process, preload bridge, and the
 * compiled renderer all wired together — exactly the path unit tests can't
 * cover (they exercise the pieces in isolation with fakes). Covers the
 * window-level flow D13 calls out: first-run vault creation through to a
 * usable triage screen.
 *
 * Needs `npm run build` to have run first — this launches the compiled
 * dist/, not source.
 */
test.describe("first run: create a vault and reach triage", () => {
  let userDataDir: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "docket-e2e-"));
  });

  test.afterEach(() => {
    removeTestDir(userDataDir);
  });

  test("shows the create-passphrase lock screen, then the triage empty state", async () => {
    const app = await electron.launch({
      args: [".", `--user-data-dir=${userDataDir}`],
    });
    const window = await app.firstWindow();

    // Fresh userData dir -> no vault yet -> create-passphrase mode.
    await expect(window.locator("h1")).toHaveText("Ledger");
    await expect(window.locator("text=Create a passphrase")).toBeVisible();

    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();

    // Unlocked -> triage screen, empty vault -> the needs-review empty state.
    await expect(window.locator(".bucket-rail")).toBeVisible();
    await expect(window.locator("text=Nothing needs review right now.")).toBeVisible();

    // The app-nav strip is present with real aria-current wayfinding (DESIGN.md a11y requirements).
    await expect(window.locator('.app-nav a[aria-current="true"]')).toHaveAttribute("aria-label", /Triage/);

    await app.close();
  });

  test("relaunching with the same passphrase reaches triage directly (no re-creation)", async () => {
    const app1 = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window1 = await app1.firstWindow();
    await window1.locator("#pass").fill("correct horse battery staple");
    await window1.locator('button[type="submit"]').click();
    await expect(window1.locator(".bucket-rail")).toBeVisible();
    await app1.close();

    const app2 = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window2 = await app2.firstWindow();
    await expect(window2.locator("text=Enter your passphrase")).toBeVisible();
    await window2.locator("#pass").fill("correct horse battery staple");
    await window2.locator('button[type="submit"]').click();
    await expect(window2.locator(".bucket-rail")).toBeVisible();
    await app2.close();
  });

  test("the wrong passphrase shows the same message a corrupted vault would (D19)", async () => {
    const app1 = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window1 = await app1.firstWindow();
    await window1.locator("#pass").fill("correct horse battery staple");
    await window1.locator('button[type="submit"]').click();
    await expect(window1.locator(".bucket-rail")).toBeVisible();
    await app1.close();

    const app2 = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window2 = await app2.firstWindow();
    await window2.locator("#pass").fill("wrong passphrase entirely");
    await window2.locator('button[type="submit"]').click();
    await expect(window2.locator("text=That passphrase didn't work.")).toBeVisible();
    await app2.close();
  });

  test("Help on the lock screen reaches crisis resources before any passphrase is entered", async () => {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    const window = await app.firstWindow();

    await window.locator("text=Help").click();
    await expect(window.locator("h1").first()).toHaveText("Support and resources");
    await expect(window.locator("text=1-800-799-7233")).toBeVisible();

    // TODOS item 3's decision: no duress mechanism, documented plainly, reachable pre-passphrase.
    await expect(window.getByText("If someone is forcing you to unlock this")).toBeVisible();
    await expect(window.getByText(/no hidden second passphrase/i)).toBeVisible();

    // The panic-hide hotkey's registration status (TODOS item 14) — real
    // registration against a real OS, not a fake. Only asserts the status
    // line renders at all (catches the wiring breaking), not which way it
    // resolves: real windows-latest CI confirmed Ctrl+Shift+Esc does NOT
    // register there (that combo is Windows' own reserved Task Manager
    // shortcut — see TODOS item 14's addendum), so asserting "active"
    // unconditionally would make this test OS-dependent on a condition
    // the fix exists specifically to handle gracefully.
    await expect(
      window.getByText("That hotkey is active on this device.").or(window.getByText(/That hotkey could not be set up/)),
    ).toBeVisible();

    await app.close();
  });
});
