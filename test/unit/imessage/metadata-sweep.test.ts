import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { sweepMessageMetadata } from "../../../src/ingest/imessage/metadata-sweep";

const ONE_HOUR_NS = 3600n * 1_000_000_000n;
const TWO_HOURS_NS = 7200n * 1_000_000_000n;

describe("sweepMessageMetadata", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-sweep-test-"));
    db = new Database(join(dir, "chat.db"));
    db.defaultSafeIntegers(true);
    db.exec(`
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
      CREATE TABLE message (
        ROWID INTEGER PRIMARY KEY, handle_id INTEGER, is_from_me INTEGER,
        date INTEGER, associated_message_type INTEGER
      );
    `);
    db.prepare("INSERT INTO handle (ROWID, id) VALUES (1, ?)").run("known-contact@example.com");
    db.prepare("INSERT INTO handle (ROWID, id) VALUES (2, ?)").run("unknown-burner@example.com");
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("surfaces every sender across all threads, including ones not selected for full ingest", () => {
    db.prepare("INSERT INTO message (handle_id, is_from_me, date, associated_message_type) VALUES (1, 0, ?, 0)").run(ONE_HOUR_NS);
    db.prepare("INSERT INTO message (handle_id, is_from_me, date, associated_message_type) VALUES (2, 0, ?, 0)").run(TWO_HOURS_NS);

    const results = sweepMessageMetadata(db);
    const senders = results.map((r) => r.sender);
    expect(senders).toContain("known-contact@example.com");
    expect(senders).toContain("unknown-burner@example.com");
  });

  it("counts messages and tracks first/last seen per sender", () => {
    db.prepare("INSERT INTO message (handle_id, is_from_me, date, associated_message_type) VALUES (1, 0, ?, 0)").run(ONE_HOUR_NS);
    db.prepare("INSERT INTO message (handle_id, is_from_me, date, associated_message_type) VALUES (1, 0, ?, 0)").run(TWO_HOURS_NS);

    const result = sweepMessageMetadata(db).find((r) => r.sender === "known-contact@example.com");
    expect(result?.messageCount).toBe(2);
    expect(result?.firstSeenAt.getTime()).toBeLessThan(result!.lastSeenAt.getTime());
  });

  it("excludes messages the user sent themselves", () => {
    db.prepare("INSERT INTO message (handle_id, is_from_me, date, associated_message_type) VALUES (1, 1, ?, 0)").run(ONE_HOUR_NS);

    const results = sweepMessageMetadata(db);
    expect(results.find((r) => r.sender === "known-contact@example.com")).toBeUndefined();
  });

  it("excludes tapbacks/reactions from the count", () => {
    db.prepare("INSERT INTO message (handle_id, is_from_me, date, associated_message_type) VALUES (1, 0, ?, 0)").run(ONE_HOUR_NS);
    db.prepare("INSERT INTO message (handle_id, is_from_me, date, associated_message_type) VALUES (1, 0, ?, 2000)").run(TWO_HOURS_NS);

    const result = sweepMessageMetadata(db).find((r) => r.sender === "known-contact@example.com");
    expect(result?.messageCount).toBe(1);
  });

  it("never reads message text — the query has no text column at all", () => {
    // This is really a design assertion: sweepMessageMetadata's SQL doesn't
    // select `text`, so there's no code path by which content could leak
    // into its output, verified here by checking the result shape has no
    // text-shaped field.
    db.prepare("INSERT INTO message (handle_id, is_from_me, date, associated_message_type) VALUES (1, 0, ?, 0)").run(ONE_HOUR_NS);
    const [result] = sweepMessageMetadata(db);
    expect(Object.keys(result!)).toEqual(["sender", "messageCount", "firstSeenAt", "lastSeenAt"]);
  });
});
