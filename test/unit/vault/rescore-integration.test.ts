import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { removeTestDir } from "../../helpers/tmp-dir";
import { SqliteVaultStore } from "../../../src/vault/sqlite-store";
import { MessageScoreStore } from "../../../src/vault/message-scores";
import type { RescorableStore } from "../../../src/vault/store";
import { createVaultMetadata, ScryptGcmVaultCrypto, type VaultKey } from "../../../src/vault/crypto";
import { rescoreUnscored } from "../../../src/score/rescore";
import type { ClassificationResult, Classifier } from "../../../src/score/classifier";
import type { Message, RawRecord } from "../../../src/types/message";

/** Scores "threat" text as a threat and everything else as harmless; records what it was asked to score. */
function keywordClassifier(seen: string[] = []): Classifier {
  return {
    classify: async ({ text }): Promise<ClassificationResult> => {
      seen.push(text);
      return text.includes("threat")
        ? { toxicityScore: 0.9, crossesAbuseThreshold: true, label: "threat" }
        : { toxicityScore: 0.01, crossesAbuseThreshold: false, label: "toxic" };
    },
  };
}

describe("rescoreUnscored against the real SqliteVaultStore", () => {
  let key: VaultKey;
  let dir: string;
  let store: SqliteVaultStore;
  let scoring: RescorableStore;

  beforeAll(async () => {
    key = await new ScryptGcmVaultCrypto(createVaultMetadata("pass")).unlock("pass");
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-rescore-"));
    const db = new Database(join(dir, "vault.db"));
    store = new SqliteVaultStore(db, key);
    const scores = new MessageScoreStore(db);
    scoring = {
      listUnscored: (by, limit) => store.listUnscored(by, limit),
      setScore: (id, hash, c, by) => scores.set(id, hash, c, by),
    };
  });

  afterEach(() => {
    store.close();
    removeTestDir(dir);
  });

  async function add(id: string, text: string, overrides: Partial<Message> = {}): Promise<void> {
    const raw: RawRecord = { id, source: "android-sms", payload: Buffer.from(id), acquiredAt: new Date(), hash: `hash-${id}`, parserVersion: "1" };
    await store.append(raw, {
      id,
      rawRecordHash: raw.hash,
      source: "android-sms",
      threadId: "5551234567",
      sender: "+15551234567",
      fromSelf: false,
      text,
      sentAt: new Date("2026-01-01T00:00:00Z"),
      provenance: "live",
      ...overrides,
    });
  }

  it("scores every unscored message from someone else, and records the model and label", async () => {
    await add("m1", "a threat");
    await add("m2", "see you friday");
    const result = await rescoreUnscored(scoring, keywordClassifier(), "model@1");

    expect(result).toEqual({ scored: 2, crossed: 1, failed: 0 });
    expect(await store.isAbusiveSender("+15551234567")).toBe(true);
    const [thread] = await store.listThreads();
    expect(thread).toMatchObject({ maxToxicityScore: 0.9, maxToxicityLabel: "threat", crossesAbuseThreshold: true });
  });

  it("never scores the user's own messages, even when they carry the other person's number", async () => {
    // Android SMS: a sent message's `sender` is the other party's address.
    await add("mine", "this is a threat I typed myself", { fromSelf: true });
    const seen: string[] = [];
    const result = await rescoreUnscored(scoring, keywordClassifier(seen), "model@1");

    expect(result.scored).toBe(0);
    expect(seen).toEqual([]);
    expect(await store.isAbusiveSender("+15551234567")).toBe(false);
  });

  it("ignores the user's own message even if it was stored as crossing the threshold", async () => {
    const raw: RawRecord = { id: "old", source: "android-sms", payload: Buffer.from("old"), acquiredAt: new Date(), hash: "hash-old", parserVersion: "1" };
    await store.append(
      raw,
      { id: "old", rawRecordHash: "hash-old", source: "android-sms", threadId: "t", sender: "+15551234567", fromSelf: true, text: "x", sentAt: new Date(), provenance: "live" },
      { crossesAbuseThreshold: true, toxicityScore: 0.99 },
    );
    expect(await store.isAbusiveSender("+15551234567")).toBe(false);
  });

  it("does nothing the second time, and rescores everything for a new model version", async () => {
    await add("m1", "a threat");
    await rescoreUnscored(scoring, keywordClassifier(), "model@1");
    expect((await rescoreUnscored(scoring, keywordClassifier(), "model@1")).scored).toBe(0);
    expect((await rescoreUnscored(scoring, keywordClassifier(), "model@2")).scored).toBe(1);
  });

  it("marks a message the model fails on as unscorable and moves on, instead of looping", async () => {
    await add("m1", "breaks the model");
    await add("m2", "a threat");
    const flaky: Classifier = {
      classify: async ({ text }) => {
        if (text.includes("breaks")) throw new Error("boom");
        return keywordClassifier().classify({ text });
      },
    };
    const result = await rescoreUnscored(scoring, flaky, "model@1");
    expect(result).toEqual({ scored: 1, crossed: 1, failed: 1 });
    expect((await rescoreUnscored(scoring, flaky, "model@1")).scored).toBe(0);
  });

  it("stops between messages when told to, for a vault that locks mid-run", async () => {
    for (let i = 0; i < 5; i++) await add(`m${i}`, "see you friday");
    let checks = 0;
    const result = await rescoreUnscored(scoring, keywordClassifier(), "model@1", () => ++checks <= 3);
    expect(result.scored).toBeLessThan(5);
  });

  it("leaves the message text and its evidence hash untouched", async () => {
    await add("m1", "a threat");
    await rescoreUnscored(scoring, keywordClassifier(), "model@1");
    const [message] = await store.list("5551234567");
    expect(message).toMatchObject({ text: "a threat", rawRecordHash: "hash-m1" });
    expect((await store.getRawRecord("hash-m1"))?.payload.toString()).toBe("m1");
  });
});
