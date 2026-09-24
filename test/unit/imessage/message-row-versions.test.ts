import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { extractMessageRowVersions } from "../../../src/ingest/imessage/message-row-versions";
import { getMessageColumns } from "../../../src/ingest/imessage/reader";

describe("extractMessageRowVersions — against a real message-shaped WAL file", () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;
  let columnNames: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-row-versions-test-"));
    dbPath = join(dir, "chat.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE message (
        ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB,
        handle_id INTEGER, is_from_me INTEGER, date INTEGER, date_edited INTEGER,
        is_deleted INTEGER, message_summary_info BLOB, associated_message_type INTEGER
      );
    `);
    columnNames = getMessageColumns(db);
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("recovers a retracted message's pre-retraction text, mapped to column names", () => {
    db.prepare(
      "INSERT INTO message (guid, text, handle_id, is_from_me, date, is_deleted, associated_message_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("guid-1", "you can't hide from me", 1, 0, 0, 0, 0);
    db.prepare("UPDATE message SET text = NULL, is_deleted = 1 WHERE ROWID = 1").run();

    const walBuffer = readFileSync(`${dbPath}-wal`);
    const versions = extractMessageRowVersions(walBuffer, columnNames);

    const preRetraction = versions.find((v) => v.rowid === 1 && v.columns.text === "you can't hide from me");
    // is_deleted=1 is small enough that SQLite encodes it with a compact
    // serial type (constant-1 or a 1-byte int), which this decoder returns
    // as a plain number — bigint only applies to 8-byte integer columns
    // like the nanosecond date fields, not small flags like this one.
    const postRetraction = versions.find((v) => v.rowid === 1 && v.columns.is_deleted === 1);

    expect(preRetraction, "pre-retraction version should be recoverable").toBeDefined();
    expect(postRetraction, "current retracted version should also be present").toBeDefined();
  });

  it("filters out rows that don't match the message table's column count", () => {
    db.prepare(
      "INSERT INTO message (guid, text, handle_id, is_from_me, date, is_deleted, associated_message_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("guid-1", "hello", 1, 0, 0, 0, 0);

    const walBuffer = readFileSync(`${dbPath}-wal`);
    // sqlite_master rows have a different column count (5) than `message`
    // (11) — none of the recovered rows should have the wrong shape.
    const versions = extractMessageRowVersions(walBuffer, columnNames);
    for (const v of versions) {
      expect(Object.keys(v.columns)).toHaveLength(columnNames.length);
    }
  });
});
