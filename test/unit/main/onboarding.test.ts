import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { initializeVault, openVault, type Vault } from "../../../src/vault/vault";
import { connectAndroidSms, connectImapSource, connectImessage, disconnect, syncNow } from "../../../src/main/onboarding";

function buildAndroidExport(smsRows: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="1">\n${smsRows}</smses>`;
}

describe("onboarding orchestration", () => {
  let dir: string;
  let vault: Vault;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-onboarding-test-"));
    await initializeVault(dir, "pass");
    vault = await openVault(dir, "pass");
  });

  afterEach(() => {
    vault.close();
    removeTestDir(dir);
  });

  it("connectAndroidSms saves the config and ingests the selected addresses", async () => {
    const exportPath = join(dir, "export.xml");
    writeFileSync(
      exportPath,
      buildAndroidExport(
        `<sms address="+15551234567" date="1700000000000" type="1" body="you can't hide from me" />\n` +
          `<sms address="5559999999" date="1700000000000" type="1" body="not selected" />\n`,
      ),
    );

    const result = await connectAndroidSms(vault, exportPath, ["+15551234567"]);
    expect(result).toEqual({ appended: 1, quarantined: 0 });

    expect(vault.sourceConfig.get("android-sms")).toEqual({
      source: "android-sms",
      exportFilePath: exportPath,
      selectedIdentifiers: ["+15551234567"],
    });

    const messages = await vault.store.list("5551234567");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("you can't hide from me");
  });

  it("syncNow re-ingests using the saved config without needing the params again", async () => {
    const exportPath = join(dir, "export.xml");
    writeFileSync(exportPath, buildAndroidExport(`<sms address="5551234567" date="1700000000000" type="1" body="first" />\n`));
    await connectAndroidSms(vault, exportPath, ["5551234567"]);

    // A second message lands in the same export file before the next sync.
    writeFileSync(
      exportPath,
      buildAndroidExport(
        `<sms address="5551234567" date="1700000000000" type="1" body="first" />\n` +
          `<sms address="5551234567" date="1700003600000" type="1" body="second" />\n`,
      ),
    );

    const result = await syncNow(vault, "android-sms");
    expect(result.appended).toBe(2); // re-processes the whole file (no checkpoint persistence yet — see TODOS.md); append() dedupes by hash

    const messages = await vault.store.list("5551234567");
    expect(messages.map((m) => m.text).sort()).toEqual(["first", "second"]);
  });

  it("syncNow throws a clear error when the source was never connected", async () => {
    await expect(syncNow(vault, "imessage")).rejects.toThrow(/isn't connected/);
  });

  it("connectImap stores the credential separately from the non-secret config", async () => {
    // connectImap will fail to actually reach a server in this test environment —
    // that's fine, this only checks what got persisted before the network call.
    await expect(
      connectImapSource(vault, { host: "imap.example.com", port: 993, secure: true, user: "victim@example.com", appPassword: "app-pass-123", mailbox: "INBOX" }, [
        "stalker@example.com",
      ]),
    ).rejects.toThrow();

    // The config and credential are saved before the ingest attempt runs,
    // so onboarding can retry a sync later without re-entering the password.
    expect(vault.sourceConfig.get("imap")).toMatchObject({ source: "imap", host: "imap.example.com", user: "victim@example.com" });
    const credential = await vault.credentials.get("victim@example.com");
    expect(credential?.secret).toBe("app-pass-123");

    // The password itself never lands in the plain config row.
    expect(JSON.stringify(vault.sourceConfig.get("imap"))).not.toContain("app-pass-123");
  });

  it("disconnect removes the config and, for imap, the stored credential", async () => {
    const exportPath = join(dir, "export.xml");
    writeFileSync(exportPath, buildAndroidExport(""));
    await connectAndroidSms(vault, exportPath, []);
    expect(vault.sourceConfig.get("android-sms")).toBeDefined();

    await disconnect(vault, "android-sms");
    expect(vault.sourceConfig.get("android-sms")).toBeUndefined();
  });

  it("connectImessage saves its config even when the dbPath doesn't exist, surfacing the real error", async () => {
    const dbPath = join(dir, "nonexistent-chat.db");
    await expect(connectImessage(vault, dbPath, ["+15551234567"])).rejects.toThrow();
    expect(vault.sourceConfig.get("imessage")).toEqual({ source: "imessage", dbPath, selectedIdentifiers: ["+15551234567"] });
  });

  it("connectImessage expands a ~ dbPath before saving it, not just before opening it", async () => {
    // Regression coverage for the bug expandHome fixed: the saved config
    // (what syncNow() re-reads later) has to be the real, already-expanded
    // path too, not the literal "~/..." the onboarding form pre-fills.
    await expect(connectImessage(vault, "~/antistalker-test-nonexistent-chat.db", ["+15551234567"])).rejects.toThrow();
    expect(vault.sourceConfig.get("imessage")).toEqual({
      source: "imessage",
      dbPath: join(homedir(), "antistalker-test-nonexistent-chat.db"),
      selectedIdentifiers: ["+15551234567"],
    });
  });
});
