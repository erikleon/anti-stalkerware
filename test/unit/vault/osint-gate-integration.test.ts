import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteVaultStore } from "../../../src/vault/sqlite-store";
import { createVaultMetadata, ScryptGcmVaultCrypto, type VaultKey } from "../../../src/vault/crypto";
import { canUnlockOsint } from "../../../src/osint/unlock";
import type { Message, RawRecord } from "../../../src/types/message";

/**
 * The OSINT gate's own tests (test/unit/osint-gate.test.ts) use a
 * hand-written fake VaultStore. This exercises the same gate logic against
 * the real, encrypted, on-disk store instead — the thing that actually
 * ships — since a gate that's only ever tested against a fake hasn't
 * really been tested against what it's guarding.
 */
describe("canUnlockOsint against the real SqliteVaultStore", () => {
  let dir: string;
  let key: VaultKey;
  let store: SqliteVaultStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "docket-osint-gate-integration-"));
    const metadata = createVaultMetadata("pass");
    key = await new ScryptGcmVaultCrypto(metadata).unlock("pass");
    store = new SqliteVaultStore(new Database(join(dir, "vault.db")), key);
  });

  afterEach(() => {
    store.close();
    removeTestDir(dir);
  });

  const raw: RawRecord = {
    id: "raw-1",
    source: "imessage",
    payload: Buffer.from("raw"),
    acquiredAt: new Date(),
    hash: "hash-1",
    parserVersion: "1",
  };

  const abusiveMessage: Message = {
    id: "msg-1",
    rawRecordHash: "hash-1",
    source: "imessage",
    threadId: "thread-a",
    sender: "stalker@example.com",
    fromSelf: false,
    text: "I know where you live",
    sentAt: new Date(),
    provenance: "live",
  };

  it("unlocks for a sender with a message that crossed the abuse threshold", async () => {
    await store.append(raw, abusiveMessage, { crossesAbuseThreshold: true });
    expect(await canUnlockOsint("stalker@example.com", store)).toBe(true);
  });

  it("refuses a sender whose only message never crossed the threshold", async () => {
    await store.append(raw, abusiveMessage, { crossesAbuseThreshold: false });
    expect(await canUnlockOsint("stalker@example.com", store)).toBe(false);
  });

  it("refuses a sender with no messages in the vault at all", async () => {
    expect(await canUnlockOsint("never-messaged-me@example.com", store)).toBe(false);
  });

  it("refuses a sender who has messages but none classified yet", async () => {
    await store.append(raw, abusiveMessage);
    expect(await canUnlockOsint("stalker@example.com", store)).toBe(false);
  });
});
