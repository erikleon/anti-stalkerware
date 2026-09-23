import { describe, expect, it } from "vitest";
import { runIngest } from "../../../src/pipeline/run-ingest";
import type { IngestAdapter, IngestResult } from "../../../src/ingest/adapter";
import type { AppendClassification, VaultStore } from "../../../src/vault/store";
import type { Classifier, ClassificationResult } from "../../../src/score/classifier";
import type { Message, RawRecord } from "../../../src/types/message";

function buildRaw(id: string): RawRecord {
  return {
    id,
    source: "imessage",
    payload: Buffer.from(id),
    acquiredAt: new Date("2026-01-01T00:00:00Z"),
    hash: `hash-${id}`,
    parserVersion: "1",
  };
}

function buildMessage(id: string, text = "hello"): Message {
  return {
    id,
    rawRecordHash: `hash-${id}`,
    source: "imessage",
    threadId: "thread-a",
    sender: "stalker@example.com",
    fromSelf: false,
    text,
    sentAt: new Date("2026-01-01T00:00:00Z"),
    provenance: "live",
  };
}

function fakeAdapter(results: IngestResult[]): IngestAdapter {
  return {
    source: "imessage",
    async *acquire() {
      for (const result of results) yield result;
    },
  };
}

function fakeVault(): VaultStore & { appended: Array<{ message: Message; classification: AppendClassification | undefined }> } {
  const appended: Array<{ message: Message; classification: AppendClassification | undefined }> = [];
  const quarantined: unknown[] = [];
  return {
    appended,
    append: async (_raw, message, classification) => {
      appended.push({ message, classification });
    },
    get: async () => undefined,
    list: async () => [],
    listThreads: async () => [],
    getRawRecord: async () => undefined,
    isAbusiveSender: async () => false,
    recordQuarantine: async (record) => {
      quarantined.push(record);
    },
    listQuarantined: async () => quarantined as never[],
  };
}

function fakeClassifier(result: ClassificationResult): Classifier {
  return { classify: async () => result };
}

describe("runIngest", () => {
  it("appends every message result to the vault", async () => {
    const adapter = fakeAdapter([
      { kind: "message", raw: buildRaw("m1"), message: buildMessage("m1") },
      { kind: "message", raw: buildRaw("m2"), message: buildMessage("m2") },
    ]);
    const vault = fakeVault();

    const result = await runIngest(adapter, vault, undefined, undefined);
    expect(result).toEqual({ appended: 2, quarantined: 0 });
    expect(vault.appended).toHaveLength(2);
  });

  it("records quarantined results instead of appending them", async () => {
    const adapter = fakeAdapter([
      {
        kind: "quarantined",
        raw: buildRaw("bad"),
        quarantine: { rawRecordHash: "hash-bad", source: "imessage", reason: "unparseable", quarantinedAt: new Date() },
      },
    ]);
    const vault = fakeVault();

    const result = await runIngest(adapter, vault, undefined, undefined);
    expect(result).toEqual({ appended: 0, quarantined: 1 });
    expect(await vault.listQuarantined()).toHaveLength(1);
  });

  it("appends unclassified (score 0, below threshold) when no classifier is configured", async () => {
    const adapter = fakeAdapter([{ kind: "message", raw: buildRaw("m1"), message: buildMessage("m1") }]);
    const vault = fakeVault();

    await runIngest(adapter, vault, undefined, undefined);
    expect(vault.appended[0]?.classification).toEqual({ toxicityScore: 0, crossesAbuseThreshold: false });
  });

  it("classifies each message when a classifier is configured", async () => {
    const adapter = fakeAdapter([{ kind: "message", raw: buildRaw("m1"), message: buildMessage("m1", "you can't hide from me") }]);
    const vault = fakeVault();
    const classifier = fakeClassifier({ toxicityScore: 0.95, crossesAbuseThreshold: true });

    await runIngest(adapter, vault, classifier, undefined);
    expect(vault.appended[0]?.classification).toEqual({ toxicityScore: 0.95, crossesAbuseThreshold: true });
  });
});
