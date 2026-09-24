import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../../helpers/tmp-dir";
import { writeInstagramExport } from "../../helpers/instagram-export";
import { decodeMetaString, inferOwnerName, loadInstagramExport, parseInstagramExport } from "../../../src/ingest/instagram/reader";
import type { IngestResult } from "../../../src/ingest/adapter";

const T0 = 1_700_000_000_000;

describe("decodeMetaString", () => {
  it("undoes Meta's byte-per-character escaping", () => {
    expect(decodeMetaString("donâ\u0080\u0099t")).toBe("don’t");
  });

  it("leaves a string that can't be escaped UTF-8 alone", () => {
    expect(decodeMetaString("already “decoded”")).toBe("already “decoded”");
  });
});

describe("Instagram export reader", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-instagram-test-"));
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  function messagesOf(results: IngestResult[]) {
    return results.flatMap((r) => (r.kind === "message" ? [r.message] : []));
  }

  it("reads threads from inbox and message requests, decoding names and text", async () => {
    writeInstagramExport(dir, {
      owner: "Me Here",
      threads: [
        {
          folder: "alexb_111",
          participants: ["Alex B", "Me Here"],
          messages: [
            { sender_name: "Alex B", timestamp_ms: T0 + 2, content: "you can’t ignore me 🙂" },
            { sender_name: "Me Here", timestamp_ms: T0 + 1, content: "please stop" },
          ],
        },
        {
          folder: "newacct_222",
          box: "message_requests",
          participants: ["New Acct", "Me Here"],
          messages: [{ sender_name: "New Acct", timestamp_ms: T0 + 3, content: "remember me?" }],
        },
      ],
    });

    const exp = await loadInstagramExport(dir);
    expect(exp.ownerName).toBe("Me Here");
    expect(exp.threads.map((t) => t.threadPath).sort()).toEqual(["inbox/alexb_111", "message_requests/newacct_222"]);

    const messages = messagesOf([...parseInstagramExport(exp, ["Alex B", "New Acct"])]);
    const alex = messages.find((m) => m.sender === "Alex B")!;
    expect(alex.text).toBe("you can’t ignore me 🙂");
    expect(alex.source).toBe("instagram");
    expect(alex.threadId).toBe("instagram:inbox/alexb_111");
    expect(alex.fromSelf).toBe(false);
    expect(messages.find((m) => m.text === "please stop")?.fromSelf).toBe(true);
    expect(messages.find((m) => m.sender === "New Acct")?.threadId).toBe("instagram:message_requests/newacct_222");
  });

  it("reads the older layout without the your_instagram_activity folder", async () => {
    writeInstagramExport(dir, {
      owner: "Me Here",
      legacyLayout: true,
      threads: [{ folder: "alexb_111", participants: ["Alex B", "Me Here"], messages: [{ sender_name: "Alex B", timestamp_ms: T0, content: "hi" }] }],
    });
    const exp = await loadInstagramExport(dir);
    expect(messagesOf([...parseInstagramExport(exp, ["Alex B"])])).toHaveLength(1);
  });

  it("imports only selected senders plus the owner's replies — never other people in a group thread", async () => {
    writeInstagramExport(dir, {
      owner: "Me Here",
      threads: [
        {
          folder: "group_333",
          participants: ["Alex B", "Bystander", "Me Here"],
          messages: [
            { sender_name: "Alex B", timestamp_ms: T0, content: "from alex" },
            { sender_name: "Bystander", timestamp_ms: T0 + 1, content: "from someone not chosen" },
            { sender_name: "Me Here", timestamp_ms: T0 + 2, content: "my reply" },
          ],
        },
        { folder: "unrelated_444", participants: ["Someone", "Me Here"], messages: [{ sender_name: "Someone", timestamp_ms: T0, content: "x" }] },
      ],
    });
    const texts = messagesOf([...parseInstagramExport(await loadInstagramExport(dir), ["Alex B"])]).map((m) => m.text);
    expect(texts.sort()).toEqual(["from alex", "my reply"]);
  });

  it("quarantines a media-only message and a message with no timestamp instead of dropping them", async () => {
    writeInstagramExport(dir, {
      owner: "Me Here",
      threads: [
        {
          folder: "alexb_111",
          participants: ["Alex B", "Me Here"],
          messages: [
            { sender_name: "Alex B", timestamp_ms: T0, photos: [{ uri: "photo.jpg" }] },
            { sender_name: "Alex B", content: "no time" },
          ],
        },
      ],
    });
    const results = [...parseInstagramExport(await loadInstagramExport(dir), ["Alex B"])];
    const reasons = results.flatMap((r) => (r.kind === "quarantined" ? [r.quarantine.reason] : []));
    expect(reasons).toHaveLength(2);
    expect(reasons.some((r) => r.includes("media isn't imported"))).toBe(true);
    expect(reasons.some((r) => r.includes("missing sender_name or timestamp_ms"))).toBe(true);
  });

  it("quarantines a thread file that isn't valid JSON, whole", async () => {
    writeInstagramExport(dir, {
      owner: "Me Here",
      threads: [{ folder: "alexb_111", participants: ["Alex B", "Me Here"], messages: [{ sender_name: "Alex B", timestamp_ms: T0, content: "hi" }] }],
    });
    const brokenDir = join(dir, "your_instagram_activity", "messages", "inbox", "broken_555");
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, "message_1.json"), "{ not json");

    const results = [...parseInstagramExport(await loadInstagramExport(dir), [])];
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("quarantined");
    if (results[0]!.kind === "quarantined") expect(results[0]!.quarantine.reason).toContain("inbox/broken_555/message_1.json");
  });

  it("gives the same message the same id and hash on a re-import", async () => {
    writeInstagramExport(dir, {
      owner: "Me Here",
      threads: [{ folder: "alexb_111", participants: ["Alex B", "Me Here"], messages: [{ sender_name: "Alex B", timestamp_ms: T0, content: "hi" }] }],
    });
    const first = messagesOf([...parseInstagramExport(await loadInstagramExport(dir), ["Alex B"])]);
    const second = messagesOf([...parseInstagramExport(await loadInstagramExport(dir), ["Alex B"])]);
    expect(second[0]!.id).toBe(first[0]!.id);
    expect(second[0]!.rawRecordHash).toBe(first[0]!.rawRecordHash);
  });

  it("works out the owner from the threads when personal information wasn't exported", async () => {
    writeInstagramExport(dir, {
      threads: [
        { folder: "a_1", participants: ["Alex B", "Me Here"], messages: [{ sender_name: "Alex B", timestamp_ms: T0, content: "a" }] },
        { folder: "b_2", participants: ["Sam", "Me Here"], messages: [{ sender_name: "Sam", timestamp_ms: T0, content: "b" }] },
      ],
    });
    expect((await loadInstagramExport(dir)).ownerName).toBe("Me Here");
  });

  it("refuses to guess the owner from a single thread", async () => {
    writeInstagramExport(dir, {
      threads: [{ folder: "a_1", participants: ["Alex B", "Me Here"], messages: [{ sender_name: "Alex B", timestamp_ms: T0, content: "a" }] }],
    });
    await expect(loadInstagramExport(dir)).rejects.toThrow(/couldn't tell which participant is you/);
    expect(inferOwnerName([])).toBeUndefined();
  });

  it("explains a folder that isn't an Instagram export", async () => {
    await expect(loadInstagramExport(dir)).rejects.toThrow(/doesn't look like an Instagram export/);
  });

  it("explains an export requested in HTML format", async () => {
    const threadDir = join(dir, "your_instagram_activity", "messages", "inbox", "alexb_111");
    mkdirSync(threadDir, { recursive: true });
    writeFileSync(join(threadDir, "message_1.html"), "<html></html>");
    await expect(loadInstagramExport(dir)).rejects.toThrow(/HTML format/);
  });
});
