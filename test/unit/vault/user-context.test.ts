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
});
