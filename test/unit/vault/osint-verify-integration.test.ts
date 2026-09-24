import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteVaultStore } from "../../../src/vault/sqlite-store";
import { createVaultMetadata, ScryptGcmVaultCrypto, type VaultKey } from "../../../src/vault/crypto";
import { messagesFromSender } from "../../../src/main/handlers";
import { buildCandidate } from "../../../src/osint/verify";
import { rankCandidates } from "../../../src/osint/rank";
import type { Message, RawRecord } from "../../../src/types/message";

/**
 * The OSINT gate's own integration test (osint-gate-integration.test.ts)
 * exercises canUnlockOsint against a real encrypted store instead of a
 * fake. This does the same for the verify-mode flow behind the gate —
 * messagesFromSender through buildCandidate through rankCandidates — the
 * exact chain handlers.ts's osint:checkCandidate runs, minus only the
 * Electron IPC glue itself. There's no e2e coverage for this in the real
 * app: reaching an OSINT-eligible sender needs a message that actually
 * crosses the abuse threshold, which needs the real ONNX classifier this
 * environment doesn't have — the same disclosed gap TODOS.md already
 * documents for the OSINT unlocked-state UI generally. append()'s
 * classification override (used here) is exactly how the gate's own
 * integration test sidesteps that.
 */
describe("OSINT verify-mode against the real SqliteVaultStore", () => {
  let dir: string;
  let key: VaultKey;
  let store: SqliteVaultStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "docket-osint-verify-integration-"));
    const metadata = createVaultMetadata("pass");
    key = await new ScryptGcmVaultCrypto(metadata).unlock("pass");
    store = new SqliteVaultStore(new Database(join(dir, "vault.db")), key);
  });

  afterEach(() => {
    store.close();
    removeTestDir(dir);
  });

  function buildRaw(id: string, hash: string): RawRecord {
    return { id, source: "imessage", payload: Buffer.from("raw"), acquiredAt: new Date(), hash, parserVersion: "1" };
  }

  function buildMessage(overrides: Partial<Message>): Message {
    return {
      id: overrides.id ?? "msg-1",
      rawRecordHash: overrides.rawRecordHash ?? "hash-msg-1",
      source: "imessage",
      threadId: "thread-a",
      sender: "unknown-abuser@example.com",
      fromSelf: false,
      text: "you'll never find me",
      sentAt: new Date("2026-01-01T00:00:00Z"),
      provenance: "live",
      ...overrides,
    };
  }

  it("finds a real, vault-held identifier-reuse signal for a candidate the user names", async () => {
    await store.append(buildRaw("1", "hash-msg-1"), buildMessage({ id: "msg-1", rawRecordHash: "hash-msg-1", text: "you can reach me at jordan@realmail.example if you ever want to talk" }), {
      crossesAbuseThreshold: true,
    });

    const senderMessages = await messagesFromSender(store, "unknown-abuser@example.com");
    const candidate = buildCandidate({ label: "Jordan", email: "jordan@realmail.example" }, "unknown-abuser@example.com", senderMessages);
    const [ranked] = rankCandidates([candidate]);

    expect(ranked?.supportingSignalCount).toBe(1);
    expect(ranked?.signals[0]?.kind).toBe("email-reuse");
    expect(ranked?.score).toBeGreaterThan(0);
  });

  it("scores an unsupported hypothesis at 0 with no signals, against real vault data", async () => {
    await store.append(buildRaw("1", "hash-msg-1"), buildMessage({ id: "msg-1", rawRecordHash: "hash-msg-1" }), { crossesAbuseThreshold: true });

    const senderMessages = await messagesFromSender(store, "unknown-abuser@example.com");
    const candidate = buildCandidate({ label: "A wrong guess", email: "nobody-related@example.com" }, "unknown-abuser@example.com", senderMessages);
    const [ranked] = rankCandidates([candidate]);

    expect(ranked?.supportingSignalCount).toBe(0);
    expect(ranked?.score).toBe(0);
  });

  it("only pulls messages from the sender being checked, not other vault threads", async () => {
    await store.append(buildRaw("1", "hash-msg-1"), buildMessage({ id: "msg-1", rawRecordHash: "hash-msg-1" }), { crossesAbuseThreshold: true });
    await store.append(
      buildRaw("2", "hash-msg-2"),
      buildMessage({ id: "msg-2", rawRecordHash: "hash-msg-2", threadId: "thread-b", sender: "someone-else@example.com", text: "candidate@example.com is my email" }),
    );

    const senderMessages = await messagesFromSender(store, "unknown-abuser@example.com");
    expect(senderMessages).toHaveLength(1);
    const candidate = buildCandidate({ label: "Wrong thread", email: "candidate@example.com" }, "unknown-abuser@example.com", senderMessages);
    expect(candidate.signals).toHaveLength(0);
  });
});
