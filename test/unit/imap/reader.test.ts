import { describe, expect, it } from "vitest";
import type { FetchMessageObject } from "imapflow";
import { fetchNewMessages, type MessageFetcher } from "../../../src/ingest/imap/reader";

function buildRawEmail(opts: { from: string; date: string; subject: string; body: string }): Buffer {
  return Buffer.from(
    `From: ${opts.from}\r\n` +
      `To: victim@example.com\r\n` +
      `Subject: ${opts.subject}\r\n` +
      `Date: ${opts.date}\r\n` +
      `Message-ID: <test-${Math.random().toString(36).slice(2)}@example.com>\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `${opts.body}\r\n`,
    "utf8",
  );
}

function fakeFetcher(messages: Array<Partial<FetchMessageObject> & { uid: number }>): MessageFetcher {
  return {
    async *fetch() {
      for (const msg of messages) {
        yield msg as FetchMessageObject;
      }
      return false;
    },
  };
}

describe("fetchNewMessages", () => {
  it("normalizes a message from a selected sender", async () => {
    const source = buildRawEmail({
      from: "stalker@example.com",
      date: "Mon, 15 Feb 2026 10:00:00 +0000",
      subject: "hey",
      body: "I know where you work now",
    });
    const fetcher = fakeFetcher([
      { uid: 5, source, envelope: { from: [{ address: "stalker@example.com" }] } as never },
    ]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("message");
    if (results[0]?.kind === "message") {
      expect(results[0].message.text?.trim()).toBe("I know where you work now");
      expect(results[0].message.sender).toBe("stalker@example.com");
      expect(results[0].message.threadId).toBe("stalker@example.com");
    }
  });

  it("skips messages from senders not selected by the user", async () => {
    const source = buildRawEmail({ from: "someone-else@example.com", date: "Mon, 15 Feb 2026 10:00:00 +0000", subject: "hi", body: "hello" });
    const fetcher = fakeFetcher([
      { uid: 5, source, envelope: { from: [{ address: "someone-else@example.com" }] } as never },
    ]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);
    expect(results).toHaveLength(0);
  });

  it("matches sender case-insensitively", async () => {
    const source = buildRawEmail({ from: "Stalker@Example.com", date: "Mon, 15 Feb 2026 10:00:00 +0000", subject: "hi", body: "hello" });
    const fetcher = fakeFetcher([
      { uid: 5, source, envelope: { from: [{ address: "Stalker@Example.com" }] } as never },
    ]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);
    expect(results).toHaveLength(1);
  });

  it("skips a message with no source bytes at all", async () => {
    const fetcher = fakeFetcher([{ uid: 5, envelope: { from: [{ address: "stalker@example.com" }] } as never }]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);
    expect(results).toHaveLength(0);
  });

  it("returns nothing when no senders are selected, rather than fetching everything", async () => {
    const source = buildRawEmail({ from: "stalker@example.com", date: "Mon, 15 Feb 2026 10:00:00 +0000", subject: "hi", body: "hello" });
    const fetcher = fakeFetcher([{ uid: 5, source, envelope: { from: [{ address: "stalker@example.com" }] } as never }]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, [], 0)) results.push(r);
    expect(results).toHaveLength(0);
  });

  it("every raw record's hash is reproducible and equals the raw RFC822 bytes", async () => {
    const source = buildRawEmail({ from: "stalker@example.com", date: "Mon, 15 Feb 2026 10:00:00 +0000", subject: "hi", body: "verify me" });
    const fetcher = fakeFetcher([{ uid: 5, source, envelope: { from: [{ address: "stalker@example.com" }] } as never }]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);

    const { hashPayload } = await import("../../../src/ingest/hash");
    expect(results[0]!.raw.payload).toEqual(source);
    expect(hashPayload(results[0]!.raw.payload)).toBe(results[0]!.raw.hash);
  });
});
