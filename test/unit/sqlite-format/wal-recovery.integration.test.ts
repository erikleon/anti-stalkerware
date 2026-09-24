import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { recoverRowsFromWal } from "../../../src/ingest/imessage/sqlite-format/wal-recovery";

/**
 * This suite doesn't construct WAL bytes by hand — it drives real SQLite
 * (via better-sqlite3) through real transactions and then parses the
 * actual .db-wal file it wrote. That's the only way to have real
 * confidence this parser matches SQLite's real output, since there's no
 * captured real chat.db sample available in this environment to test
 * against. It validates the WAL/page/record format handling; it does not
 * validate anything iMessage-schema-specific (message_summary_info, edit
 * chronology semantics), which stays unverified — see summary-info.ts.
 */
describe("recoverRowsFromWal — against a real SQLite WAL file", () => {
  let dir: string;
  let dbPath: string;
  let walPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-wal-test-"));
    dbPath = join(dir, "test.db");
    walPath = `${dbPath}-wal`;
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE t (text TEXT, flag INTEGER)");
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("recovers a row's content directly from a live WAL file", () => {
    db.prepare("INSERT INTO t (text, flag) VALUES (?, ?)").run("original text", 0);

    const walBuffer = readFileSync(walPath);
    const recovered = [...recoverRowsFromWal(walBuffer)];

    // ROWIDs are per-table, not database-wide: sqlite_master's own row 1
    // (the CREATE TABLE entry for `t`) also has rowid 1, on a different
    // page, with a different column count. Real matching (in reader.ts)
    // disambiguates the same way — by expected column shape — since a WAL
    // frame carries a page number, not a table name.
    const match = recovered.find((r) => r.rowid === 1 && !r.incomplete && r.columns.length === 2);
    expect(match).toBeDefined();
    expect(match?.columns).toEqual(["original text", 0]);
  });

  it("still finds the pre-update row version after an UPDATE, before any checkpoint", () => {
    db.prepare("INSERT INTO t (text, flag) VALUES (?, ?)").run("original text", 0);
    db.prepare("UPDATE t SET text = NULL, flag = 1 WHERE rowid = 1").run();

    const walBuffer = readFileSync(walPath);
    const recovered = [...recoverRowsFromWal(walBuffer)].filter((r) => r.rowid === 1 && !r.incomplete);

    const preUpdate = recovered.find((r) => r.columns[0] === "original text");
    const postUpdate = recovered.find((r) => r.columns[0] === null && r.columns[1] === 1);

    expect(preUpdate, "the pre-update row version should still be present in the WAL").toBeDefined();
    expect(postUpdate, "the current row version should also be present").toBeDefined();
  });

  it("finds nothing for that row once a checkpoint has truncated the WAL", () => {
    db.prepare("INSERT INTO t (text, flag) VALUES (?, ?)").run("original text", 0);
    db.prepare("UPDATE t SET text = NULL, flag = 1 WHERE rowid = 1").run();
    db.pragma("wal_checkpoint(TRUNCATE)");

    const walBuffer = readFileSync(walPath);
    const recovered = [...recoverRowsFromWal(walBuffer)];

    expect(recovered).toHaveLength(0);
  });

  it("recovers multiple distinct rows correctly", () => {
    db.prepare("INSERT INTO t (text, flag) VALUES (?, ?)").run("first", 0);
    db.prepare("INSERT INTO t (text, flag) VALUES (?, ?)").run("second", 0);

    const walBuffer = readFileSync(walPath);
    const recovered = [...recoverRowsFromWal(walBuffer)].filter((r) => !r.incomplete);

    expect(recovered.some((r) => r.rowid === 1 && r.columns[0] === "first")).toBe(true);
    expect(recovered.some((r) => r.rowid === 2 && r.columns[0] === "second")).toBe(true);
  });
});
