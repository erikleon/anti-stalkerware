import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteVaultStore } from "../../../src/vault/sqlite-store";
import { createVaultMetadata, ScryptGcmVaultCrypto, type VaultKey } from "../../../src/vault/crypto";
import type { Message, RawRecord } from "../../../src/types/message";

function buildRaw(overrides: Partial<RawRecord> = {}): RawRecord {
  return {
    id: "raw-1",
    source: "imessage",
    payload: Buffer.from("raw payload bytes", "utf8"),
    acquiredAt: new Date("2026-01-01T00:00:00Z"),
    hash: "hash-1",
    parserVersion: "1",
    ...overrides,
  };
}

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    rawRecordHash: "hash-1",
    threadId: "thread-a",
    sender: "stalker@example.com",
    fromSelf: false,
    text: "you can't hide from me",
    sentAt: new Date("2026-01-01T00:00:00Z"),
    provenance: "live",
    ...overrides,
  };
}

describe("SqliteVaultStore", () => {
  let dir: string;
  let dbPath: string;
  let key: VaultKey;
  let store: SqliteVaultStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-vault-store-test-"));
    dbPath = join(dir, "vault.db");
    const metadata = createVaultMetadata("test passphrase");
    key = await new ScryptGcmVaultCrypto(metadata).unlock("test passphrase");
    store = new SqliteVaultStore(new Database(dbPath), key);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a message through append and get", async () => {
    const raw = buildRaw();
    const message = buildMessage();
    await store.append(raw, message);

    const fetched = await store.get("msg-1");
    expect(fetched?.text).toBe("you can't hide from me");
    expect(fetched?.sender).toBe("stalker@example.com");
    expect(fetched?.threadId).toBe("thread-a");
    expect(fetched?.fromSelf).toBe(false);
    expect(fetched?.sentAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("round-trips edit history and retractedAt", async () => {
    const raw = buildRaw();
    const message = buildMessage({
      editHistory: [{ text: "original wording", editedAt: new Date("2026-01-01T00:00:00Z") }],
      retractedAt: new Date("2026-01-02T00:00:00Z"),
    });
    await store.append(raw, message);

    const fetched = await store.get("msg-1");
    expect(fetched?.editHistory).toHaveLength(1);
    expect(fetched?.editHistory?.[0]?.text).toBe("original wording");
    expect(fetched?.retractedAt?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("getRawRecord returns the decrypted original payload", async () => {
    const raw = buildRaw({ hash: "hash-xyz", payload: Buffer.from("original raw bytes") });
    await store.append(raw, buildMessage({ rawRecordHash: "hash-xyz" }));

    const fetched = await store.getRawRecord("hash-xyz");
    expect(fetched?.payload.toString()).toBe("original raw bytes");
  });

  it("list returns messages in a thread ordered by sentAt", async () => {
    await store.append(buildRaw({ hash: "h1" }), buildMessage({ id: "m1", rawRecordHash: "h1", sentAt: new Date("2026-01-02T00:00:00Z"), text: "second" }));
    await store.append(buildRaw({ hash: "h2" }), buildMessage({ id: "m2", rawRecordHash: "h2", sentAt: new Date("2026-01-01T00:00:00Z"), text: "first" }));

    const list = await store.list("thread-a");
    expect(list.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("list only returns messages from the requested thread", async () => {
    await store.append(buildRaw({ hash: "h1" }), buildMessage({ id: "m1", rawRecordHash: "h1", threadId: "thread-a" }));
    await store.append(buildRaw({ hash: "h2" }), buildMessage({ id: "m2", rawRecordHash: "h2", threadId: "thread-b", text: "other thread" }));

    const list = await store.list("thread-a");
    expect(list).toHaveLength(1);
  });

  it("isAbusiveSender reflects classification passed at append time", async () => {
    await store.append(buildRaw(), buildMessage(), { crossesAbuseThreshold: true });
    expect(await store.isAbusiveSender("stalker@example.com")).toBe(true);
    expect(await store.isAbusiveSender("someone-else@example.com")).toBe(false);
  });

  it("a message appended without a classification never counts as abusive", async () => {
    await store.append(buildRaw(), buildMessage());
    expect(await store.isAbusiveSender("stalker@example.com")).toBe(false);
  });

  it("re-appending the same raw record hash is a no-op, not an overwrite or an error", async () => {
    const raw = buildRaw();
    await store.append(raw, buildMessage());
    await expect(store.append(raw, buildMessage())).resolves.not.toThrow();

    const rawRows = new Database(dbPath, { readonly: true }).prepare("SELECT COUNT(*) as c FROM raw_records").get() as { c: number };
    expect(rawRows.c).toBe(1);
  });

  it("an edited message accumulates as a new version rather than replacing the old one", async () => {
    await store.append(buildRaw({ hash: "h1" }), buildMessage({ id: "m1", rawRecordHash: "h1", text: "first version", sentAt: new Date("2026-01-01T00:00:00Z") }));
    await store.append(buildRaw({ hash: "h2" }), buildMessage({ id: "m1", rawRecordHash: "h2", text: "edited version", sentAt: new Date("2026-01-01T00:00:01Z") }));

    // get() surfaces the latest version...
    const fetched = await store.get("m1");
    expect(fetched?.text).toBe("edited version");

    // ...but both versions are still physically present, unlocked/decrypted directly.
    const rows = new Database(dbPath, { readonly: true }).prepare("SELECT COUNT(*) as c FROM messages WHERE message_id = 'm1'").get() as { c: number };
    expect(rows.c).toBe(2);
  });

  it("quarantine records survive independently of messages", async () => {
    await store.recordQuarantine({
      rawRecordHash: "bad-hash",
      source: "imessage",
      reason: "unparseable bplist",
      quarantinedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const quarantined = await store.listQuarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.reason).toBe("unparseable bplist");
  });

  it("message text and raw payloads are not stored as plaintext on disk", async () => {
    await store.append(buildRaw({ payload: Buffer.from("SECRET_RAW_MARKER") }), buildMessage({ text: "SECRET_TEXT_MARKER" }));

    // Read the raw file bytes directly, bypassing the store entirely.
    const fileBytes = readFileSync(dbPath);
    expect(fileBytes.includes("SECRET_TEXT_MARKER")).toBe(false);
    expect(fileBytes.includes("SECRET_RAW_MARKER")).toBe(false);
  });

  it("has no UPDATE or DELETE statement anywhere in its source — append-only by construction, not just by convention", async () => {
    const source = readFileSync(join(__dirname, "../../../src/vault/sqlite-store.ts"), "utf8");
    // Strip comments first — the module's own doc comment explains the
    // append-only guarantee in prose, and prose is allowed to say the word.
    // What must never appear is the SQL keyword inside an actual statement.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(/\bUPDATE\s+\w/i.test(codeOnly)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(codeOnly)).toBe(false);
  });
});
