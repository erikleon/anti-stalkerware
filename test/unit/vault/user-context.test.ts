import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { UserContextStore } from "../../../src/vault/user-context";

describe("UserContextStore", () => {
  let dir: string;
  let db: Database.Database;
  let store: UserContextStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-user-context-test-"));
    db = new Database(join(dir, "vault.db"));
    store = new UserContextStore(db);
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("starts empty", () => {
    expect(store.listBoundaries()).toEqual([]);
    expect(store.listTaggedPhrases()).toEqual([]);
  });

  it("addBoundary assigns an id and round-trips through listBoundaries", () => {
    const added = store.addBoundary({ setAt: new Date("2026-08-01T00:00:00Z"), description: "told them to stop contacting me" });
    expect(added.id).toBeTruthy();

    const listed = store.listBoundaries();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(added);
  });

  it("a boundary scoped to a sender keeps that field; an unscoped one omits it", () => {
    store.addBoundary({ setAt: new Date(), description: "unscoped" });
    store.addBoundary({ setAt: new Date(), description: "scoped", appliesToSender: "stalker@example.com" });

    const listed = store.listBoundaries();
    expect(listed.find((b) => b.description === "unscoped")?.appliesToSender).toBeUndefined();
    expect(listed.find((b) => b.description === "scoped")?.appliesToSender).toBe("stalker@example.com");
  });

  it("removeBoundary deletes only the targeted one", () => {
    const a = store.addBoundary({ setAt: new Date(), description: "a" });
    const b = store.addBoundary({ setAt: new Date(), description: "b" });

    store.removeBoundary(a.id);
    const remaining = store.listBoundaries();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(b.id);
  });

  it("addTaggedPhrase assigns an id and round-trips through listTaggedPhrases", () => {
    const added = store.addTaggedPhrase({ phrase: "peaches", note: "our old nickname, only they'd use it" });
    expect(store.listTaggedPhrases()).toEqual([added]);
  });

  it("removeTaggedPhrase deletes only the targeted one", () => {
    const a = store.addTaggedPhrase({ phrase: "a", note: "a" });
    const b = store.addTaggedPhrase({ phrase: "b", note: "b" });

    store.removeTaggedPhrase(a.id);
    const remaining = store.listTaggedPhrases();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(b.id);
  });

  it("addBoundaryOnDate starts the boundary at local midnight and keeps the date as picked", () => {
    const added = store.addBoundaryOnDate("told them to stop", "2026-09-24", "America/New_York");
    expect(added.setAt.toISOString()).toBe("2026-09-24T04:00:00.000Z");
    expect(store.listBoundaries()[0]).toMatchObject({ setOn: "2026-09-24", timeZone: "America/New_York" });
  });
});

describe("UserContextStore repair of boundaries saved as UTC midnight", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-user-context-repair-test-"));
    db = new Database(join(dir, "vault.db"));
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("re-reads an old form's UTC-midnight boundary as the local start of that date, once", () => {
    const old = new UserContextStore(db);
    // What the old form wrote for a boundary picked as 2026-09-24.
    old.addBoundary({ setAt: new Date("2026-09-24T00:00:00.000Z"), description: "old form" });
    // Not from the date form: a real instant that must stay as is.
    old.addBoundary({ setAt: new Date("2026-09-24T15:30:00.000Z"), description: "exact instant" });
    // Already has a picked date: never touched.
    old.addBoundaryOnDate("new form", "2026-09-20", "Asia/Tokyo");

    const repaired = new UserContextStore(db, "America/New_York").listBoundaries();
    const byDescription = new Map(repaired.map((b) => [b.description, b]));
    expect(byDescription.get("old form")).toMatchObject({ setOn: "2026-09-24", timeZone: "America/New_York" });
    expect(byDescription.get("old form")!.setAt.toISOString()).toBe("2026-09-24T04:00:00.000Z");
    expect(byDescription.get("exact instant")!.setAt.toISOString()).toBe("2026-09-24T15:30:00.000Z");
    expect(byDescription.get("exact instant")!.setOn).toBeUndefined();
    expect(byDescription.get("new form")).toMatchObject({ setOn: "2026-09-20", timeZone: "Asia/Tokyo" });

    // A second open in another zone changes nothing: the repaired row now has a set_on.
    const again = new UserContextStore(db, "Asia/Tokyo").listBoundaries();
    expect(again.find((b) => b.description === "old form")!.setAt.toISOString()).toBe("2026-09-24T04:00:00.000Z");
  });

  it("adds the new columns to a table created before they existed", () => {
    db.exec(`CREATE TABLE user_boundaries (id TEXT PRIMARY KEY, set_at TEXT NOT NULL, description TEXT NOT NULL, applies_to_sender TEXT)`);
    db.prepare(`INSERT INTO user_boundaries VALUES ('b1', '2026-01-01T00:00:00.000Z', 'legacy', NULL)`).run();
    const store = new UserContextStore(db, "UTC");
    expect(store.listBoundaries()[0]).toMatchObject({ setOn: "2026-01-01", timeZone: "UTC" });
  });
});
