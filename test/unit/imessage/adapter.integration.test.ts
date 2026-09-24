import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ImessageAdapter, watchForRetractions, type RecoveredRetraction } from "../../../src/ingest/imessage/adapter";

function buildChatDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
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
  db.prepare("INSERT INTO handle (ROWID, id) VALUES (1, ?)").run("stalker@example.com");
  db.prepare("INSERT INTO chat (ROWID, guid, chat_identifier) VALUES (1, 'chat-1', 'thread-a')").run();
  return db;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("ImessageAdapter", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-adapter-test-"));
    dbPath = join(dir, "chat.db");
    buildChatDb(dbPath).close();
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  it("acquires messages scoped to the selected threads, honoring a checkpoint", async () => {
    const db = new Database(dbPath);
    db.prepare(
      "INSERT INTO message (guid, text, handle_id, is_from_me, date, is_deleted, associated_message_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("guid-1", "first message", 1, 0, 0, 0, 0);
    const secondId = db
      .prepare(
        "INSERT INTO message (guid, text, handle_id, is_from_me, date, is_deleted, associated_message_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("guid-2", "second message", 1, 0, 0, 0, 0).lastInsertRowid;
    db.prepare("INSERT INTO chat_message_join (chat_id, message_id) VALUES (1, 1), (1, 2)").run();
    db.close();

    const adapter = new ImessageAdapter({ dbPath, selectedThreadIdentifiers: ["thread-a"] });

    const all = [];
    for await (const r of adapter.acquire(undefined)) all.push(r);
    expect(all).toHaveLength(2);

    const sinceFirst = [];
    for await (const r of adapter.acquire("1")) sinceFirst.push(r);
    expect(sinceFirst).toHaveLength(1);
    if (sinceFirst[0]?.kind === "message") {
      expect(sinceFirst[0].message.text).toBe("second message");
    }
    void secondId;
  });
});

describe("watchForRetractions", () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-retraction-watch-test-"));
    dbPath = join(dir, "chat.db");
    db = buildChatDb(dbPath);
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("reports a recovered pre-retraction row once the sender unsends a message", async () => {
    db.prepare(
      "INSERT INTO message (guid, text, handle_id, is_from_me, date, is_deleted, associated_message_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("guid-1", "you can't hide from me", 1, 0, 0, 0, 0);

    const batches: RecoveredRetraction[][] = [];
    const handle = watchForRetractions(db, `${dbPath}-wal`, (rows) => batches.push(rows), {
      pollIntervalMs: 150,
      debounceMs: 10,
    });

    try {
      db.prepare("UPDATE message SET text = NULL, is_deleted = 1 WHERE ROWID = 1").run();

      await waitUntil(() => {
        return batches.some((batch) => batch.some((r) => r.columns.text === "you can't hide from me"));
      }, 3000);

      const recovered = batches.flat().find((r) => r.columns.text === "you can't hide from me");
      expect(recovered).toBeDefined();
    } finally {
      handle.stop();
    }
  });
});
