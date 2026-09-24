import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SourceConfigStore, type SourceConfig } from "../../../src/vault/source-config";

describe("SourceConfigStore", () => {
  let dir: string;
  let db: Database.Database;
  let store: SourceConfigStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-source-config-test-"));
    db = new Database(join(dir, "vault.db"));
    store = new SourceConfigStore(db);
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("returns undefined for a source that's never been configured", () => {
    expect(store.get("imessage")).toBeUndefined();
  });

  it("round-trips an imessage config", () => {
    const config: SourceConfig = { source: "imessage", dbPath: "/Users/x/Library/Messages/chat.db", selectedIdentifiers: ["+15551234567"] };
    store.save(config);
    expect(store.get("imessage")).toEqual(config);
  });

  it("round-trips an imap config (no secret in here — that's CredentialStore's job)", () => {
    const config: SourceConfig = {
      source: "imap",
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: "victim@example.com",
      mailbox: "INBOX",
      selectedIdentifiers: ["stalker@example.com"],
    };
    store.save(config);
    expect(store.get("imap")).toEqual(config);
  });

  it("save overwrites the previous config for the same source rather than accumulating rows", () => {
    store.save({ source: "android-sms", exportFilePath: "/a.xml", selectedIdentifiers: ["111"] });
    store.save({ source: "android-sms", exportFilePath: "/b.xml", selectedIdentifiers: ["222"] });

    expect(store.get("android-sms")).toEqual({ source: "android-sms", exportFilePath: "/b.xml", selectedIdentifiers: ["222"] });
    const count = db.prepare("SELECT COUNT(*) as c FROM source_config").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("getAll returns every configured source", () => {
    store.save({ source: "imessage", dbPath: "/chat.db", selectedIdentifiers: [] });
    store.save({ source: "android-sms", exportFilePath: "/a.xml", selectedIdentifiers: [] });

    expect(store.getAll().map((c) => c.source).sort()).toEqual(["android-sms", "imessage"]);
  });

  it("remove disconnects a source", () => {
    store.save({ source: "imessage", dbPath: "/chat.db", selectedIdentifiers: [] });
    store.remove("imessage");
    expect(store.get("imessage")).toBeUndefined();
  });
});
