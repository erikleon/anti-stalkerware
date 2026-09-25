import { describe, expect, it } from "vitest";
import { buildExportPayload, listAllMessages } from "../../../src/vault/export";
import type { Message, RawRecord } from "../../../src/types/message";
import type { ThreadSummary, VaultStore } from "../../../src/vault/store";

function buildMessage(id: string, threadId: string): Message {
  return {
    id,
    rawRecordHash: `hash-${id}`,
    source: "imessage",
    threadId,
    sender: "stalker@example.com",
    fromSelf: false,
    text: id,
    sentAt: new Date("2026-01-01T00:00:00Z"),
    provenance: "live",
  };
}

function buildThread(threadId: string): ThreadSummary {
  return {
    threadId,
    sender: "stalker@example.com",
    latestMessageId: `${threadId}-latest`,
    latestText: "latest",
    latestSentAt: new Date("2026-01-01T00:00:00Z"),
    messageCount: 1,
    maxToxicityScore: 0,
    crossesAbuseThreshold: false,
  };
}

function fakeVault(byThread: Record<string, Message[]>): VaultStore {
  return {
    append: async () => undefined,
    get: async () => undefined,
    list: async (threadId: string) => byThread[threadId] ?? [],
    listThreads: async () => Object.keys(byThread).map(buildThread),
    getRawRecord: async () => undefined as RawRecord | undefined,
    isAbusiveSender: async () => false,
    recordQuarantine: async () => undefined,
    listQuarantined: async () => [],
  };
}

describe("listAllMessages", () => {
  it("flattens every thread's messages into one list", async () => {
    const vault = fakeVault({
      "thread-a": [buildMessage("m1", "thread-a")],
      "thread-b": [buildMessage("m2", "thread-b"), buildMessage("m3", "thread-b")],
    });

    const all = await listAllMessages(vault);
    expect(all.map((m) => m.id).sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("returns an empty list for an empty vault", async () => {
    const vault = fakeVault({});
    expect(await listAllMessages(vault)).toEqual([]);
  });
});

describe("buildExportPayload", () => {
  it("carries the disclosure text and every message's evidentiary fields", () => {
    const payload = buildExportPayload([buildMessage("m1", "thread-a")], "UTC");
    expect(payload.disclosure).toContain("does not prove");
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toMatchObject({ id: "m1", threadId: "thread-a", rawRecordHash: "hash-m1" });
  });

  it("writes each message's local time with its zone next to the UTC time", () => {
    const message = { ...buildMessage("m1", "thread-a"), sentAt: new Date("2026-09-24T01:00:00.000Z") };
    const payload = buildExportPayload([message], "America/New_York");
    expect(payload.timeZone).toBe("America/New_York");
    expect(payload.messages[0]).toMatchObject({
      sentAt: "2026-09-24T01:00:00.000Z",
      sentAtLocal: "2026-09-23T21:00:00.000-04:00[America/New_York]",
    });
  });

  it("carries the incident log with its own disclosure and every revision", () => {
    const entry = {
      id: "i1",
      occurredAt: new Date("2026-11-01T06:30:00.000Z"),
      occurredLocal: "2026-11-01T01:30:00.000-05:00[America/New_York]",
      involving: "Jordan",
      revisions: [
        { revision: 1, writtenAt: new Date("2026-11-01T12:00:00.000Z"), html: "<p>first</p>", text: "first" },
        { revision: 2, writtenAt: new Date("2026-11-02T12:00:00.000Z"), html: "<p>second</p>", text: "second" },
      ],
    };
    const payload = buildExportPayload([], "America/New_York", [entry]);
    expect(payload.incidentLogDisclosure).toContain("not records captured");
    expect(payload.incidentLog[0]).toMatchObject({ id: "i1", occurredAt: "2026-11-01T06:30:00.000Z", involving: "Jordan" });
    expect(payload.incidentLog[0]!.revisions.map((r) => [r.revision, r.text, r.writtenAtLocal])).toEqual([
      [1, "first", "2026-11-01T07:00:00.000-05:00[America/New_York]"],
      [2, "second", "2026-11-02T07:00:00.000-05:00[America/New_York]"],
    ]);
  });

  it("leaves out the local time before 1970 instead of failing the export", () => {
    const message = { ...buildMessage("m1", "thread-a"), sentAt: new Date("1969-12-31T00:00:00.000Z") };
    const [exported] = buildExportPayload([message], "America/New_York").messages;
    expect(exported?.sentAt).toBe("1969-12-31T00:00:00.000Z");
    expect(exported?.sentAtLocal).toBeUndefined();
  });
});
