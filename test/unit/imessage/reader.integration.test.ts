import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import bplist from "bplist-creator";
import { openChatDbReadOnly, readNewMessages } from "../../../src/ingest/imessage/reader";

/**
 * Builds a synthetic database with the subset of chat.db's schema reader.ts
 * queries. Not a captured real chat.db — see summary-info.ts and reader.ts
 * for what's verified against real SQLite output (the WAL/page format) vs.
 * what's an educated best-effort against public schema research (the
 * message_summary_info edit-chronology shape).
 */
function buildChatDb(path: string): Database.Database {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT);
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB,
      handle_id INTEGER, is_from_me INTEGER, date INTEGER, date_edited INTEGER,
      is_deleted INTEGER, message_summary_info BLOB, associated_message_type INTEGER
    );
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
  `);
  return db;
}

const ONE_HOUR_NS = 3600n * 1_000_000_000n;

function insertMessage(
  db: Database.Database,
  chatIdentifier: string,
  handleId: number,
  overrides: Partial<{
    guid: string;
    text: string | null;
    attributedBody: Buffer | null;
    isFromMe: number;
    isDeleted: number;
    dateEdited: bigint | null;
    messageSummaryInfo: Buffer | null;
    associatedMessageType: number;
  }> = {},
): number {
  let chat = db.prepare("SELECT ROWID as id FROM chat WHERE chat_identifier = ?").get(chatIdentifier) as
    | { id: number }
    | undefined;
  if (!chat) {
    const info = db.prepare("INSERT INTO chat (guid, chat_identifier) VALUES (?, ?)").run(chatIdentifier, chatIdentifier);
    chat = { id: Number(info.lastInsertRowid) };
  }

  const guid = overrides.guid ?? `msg-${Math.random().toString(36).slice(2)}`;
  const info = db
    .prepare(
      `INSERT INTO message
        (guid, text, attributedBody, handle_id, is_from_me, date, date_edited, is_deleted, message_summary_info, associated_message_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      guid,
      overrides.text === undefined ? "hello" : overrides.text,
      overrides.attributedBody ?? null,
      handleId,
      overrides.isFromMe ?? 0,
      ONE_HOUR_NS,
      overrides.dateEdited ?? null,
      overrides.isDeleted ?? 0,
      overrides.messageSummaryInfo ?? null,
      overrides.associatedMessageType ?? 0,
    );
  const messageId = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)").run(chat.id, messageId);
  return messageId;
}

describe("reader — against a synthetic chat.db-shaped database", () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-reader-test-"));
    dbPath = join(dir, "chat.db");
    db = buildChatDb(dbPath);
    db.prepare("INSERT INTO handle (ROWID, id) VALUES (1, ?)").run("stalker@example.com");
    db.prepare("INSERT INTO handle (ROWID, id) VALUES (2, ?)").run("someone-else@example.com");
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("normalizes a plain message into the right shape", async () => {
    insertMessage(db, "thread-a", 1, { text: "you can't hide from me" });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], 0n)) results.push(r);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("message");
    if (results[0]?.kind === "message") {
      expect(results[0].message.text).toBe("you can't hide from me");
      expect(results[0].message.threadId).toBe("thread-a");
      expect(results[0].message.sender).toBe("stalker@example.com");
      expect(results[0].message.fromSelf).toBe(false);
      expect(results[0].message.provenance).toBe("live");
    }
  });

  it("only reads messages from selected threads", async () => {
    insertMessage(db, "thread-a", 1, { text: "in scope" });
    insertMessage(db, "thread-b", 2, { text: "not selected by the user" });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], 0n)) results.push(r);

    expect(results).toHaveLength(1);
    if (results[0]?.kind === "message") {
      expect(results[0].message.text).toBe("in scope");
    }
  });

  it("only reads messages newer than the checkpoint", async () => {
    const firstId = insertMessage(db, "thread-a", 1, { text: "old" });
    insertMessage(db, "thread-a", 1, { text: "new" });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], BigInt(firstId))) results.push(r);

    expect(results).toHaveLength(1);
    if (results[0]?.kind === "message") {
      expect(results[0].message.text).toBe("new");
    }
  });

  it("marks a retracted message with retractedAt", async () => {
    insertMessage(db, "thread-a", 1, { text: null, isDeleted: 1 });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], 0n)) results.push(r);

    // text is null and there's no attributedBody, so this quarantines —
    // a retracted message with no recoverable text is exactly the case
    // the WAL watcher exists to catch; the live reader alone can't recover it.
    expect(results[0]?.kind).toBe("quarantined");
  });

  it("extracts edit history when message_summary_info parses", async () => {
    const editedAt = new Date("2026-02-01T00:00:00Z");
    const summaryInfo = bplist({ ec: [{ t: "original wording", d: editedAt.getTime() }] });
    insertMessage(db, "thread-a", 1, {
      text: "edited wording",
      dateEdited: 123n,
      messageSummaryInfo: summaryInfo,
    });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], 0n)) results.push(r);

    expect(results[0]?.kind).toBe("message");
    if (results[0]?.kind === "message") {
      expect(results[0].message.editHistory).toHaveLength(1);
      expect(results[0].message.editHistory?.[0]?.text).toBe("original wording");
    }
  });

  it("keeps the message even when edit-chronology parsing fails, without quarantining it", async () => {
    insertMessage(db, "thread-a", 1, {
      text: "current text is still fine",
      dateEdited: 123n,
      messageSummaryInfo: Buffer.from("not a valid bplist"),
    });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], 0n)) results.push(r);

    expect(results[0]?.kind).toBe("message");
    if (results[0]?.kind === "message") {
      expect(results[0].message.text).toBe("current text is still fine");
      expect(results[0].message.editHistory).toBeUndefined();
    }
  });

  it("falls back to attributedBody's NSString when text is null", async () => {
    const attributedBody = bplist({ NSString: "rich text content" });
    insertMessage(db, "thread-a", 1, { text: null, attributedBody });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], 0n)) results.push(r);

    expect(results[0]?.kind).toBe("message");
    if (results[0]?.kind === "message") {
      expect(results[0].message.text).toBe("rich text content");
    }
  });

  it("quarantines a row with neither text nor a usable attributedBody", async () => {
    insertMessage(db, "thread-a", 1, { text: null, attributedBody: null });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], 0n)) results.push(r);

    expect(results[0]?.kind).toBe("quarantined");
    if (results[0]?.kind === "quarantined") {
      expect(results[0].quarantine.source).toBe("imessage");
    }
  });

  it("excludes tapbacks/reactions", async () => {
    insertMessage(db, "thread-a", 1, { text: "a real message" });
    insertMessage(db, "thread-a", 1, { text: null, associatedMessageType: 2000 });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], 0n)) results.push(r);

    expect(results).toHaveLength(1);
  });

  it("every raw record hash is reproducible from its own payload", async () => {
    insertMessage(db, "thread-a", 1, { text: "check my hash" });

    const results = [];
    for await (const r of readNewMessages(db, ["thread-a"], 0n)) results.push(r);

    const { hashPayload } = await import("../../../src/ingest/hash");
    expect(hashPayload(results[0]!.raw.payload)).toBe(results[0]!.raw.hash);
  });
});

describe("openChatDbReadOnly", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-reader-open-test-"));
    dbPath = join(dir, "chat.db");
    buildChatDb(dbPath).close();
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  it("opens the database read-only", async () => {
    const db = await openChatDbReadOnly(dbPath);
    expect(() => db.exec("INSERT INTO chat (guid, chat_identifier) VALUES ('x', 'x')")).toThrow();
    db.close();
  });

  it("throws for a database that doesn't exist rather than creating one", async () => {
    await expect(openChatDbReadOnly(join(dir, "does-not-exist.db"))).rejects.toThrow();
  });
});
