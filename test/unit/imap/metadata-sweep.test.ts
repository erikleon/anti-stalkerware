import { describe, expect, it } from "vitest";
import type { FetchMessageObject } from "imapflow";
import { sweepImapSenders } from "../../../src/ingest/imap/metadata-sweep";
import type { MessageFetcher } from "../../../src/ingest/imap/reader";

function fakeFetcher(messages: Array<Partial<FetchMessageObject>>): MessageFetcher {
  return {
    async *fetch() {
      for (const msg of messages) {
        yield msg as FetchMessageObject;
      }
      return false;
    },
  };
}

describe("sweepImapSenders", () => {
  it("aggregates message count and first/last seen per sender, unfiltered", async () => {
    const fetcher = fakeFetcher([
      { envelope: { from: [{ address: "stalker@example.com" }], date: "2026-01-01T00:00:00Z" } as never },
      { envelope: { from: [{ address: "stalker@example.com" }], date: "2026-01-02T00:00:00Z" } as never },
      { envelope: { from: [{ address: "friend@example.com" }], date: "2026-01-01T00:00:00Z" } as never },
    ]);

    const results = await sweepImapSenders(fetcher);
    expect(results).toHaveLength(2);

    const stalker = results.find((r) => r.sender === "stalker@example.com");
    expect(stalker?.messageCount).toBe(2);
    expect(stalker?.firstSeenAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(stalker?.lastSeenAt.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("lowercases sender addresses so the same account doesn't split into two rows", async () => {
    const fetcher = fakeFetcher([
      { envelope: { from: [{ address: "Stalker@Example.com" }], date: "2026-01-01T00:00:00Z" } as never },
      { envelope: { from: [{ address: "stalker@example.com" }], date: "2026-01-02T00:00:00Z" } as never },
    ]);

    const results = await sweepImapSenders(fetcher);
    expect(results).toHaveLength(1);
    expect(results[0]?.messageCount).toBe(2);
  });

  it("skips a message with no sender envelope rather than throwing", async () => {
    const fetcher = fakeFetcher([{ envelope: {} as never }]);
    await expect(sweepImapSenders(fetcher)).resolves.toEqual([]);
  });
});
