import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { TriageStateStore } from "../../../src/vault/triage-state";

describe("TriageStateStore", () => {
  let dir: string;
  let db: Database.Database;
  let store: TriageStateStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-triage-state-test-"));
    db = new Database(join(dir, "vault.db"));
    store = new TriageStateStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to not reviewed, not hidden for a message with no recorded state", () => {
    expect(store.get("msg-1")).toEqual({ reviewed: false, hidden: false });
  });

  it("setReviewed persists and can be flipped back", () => {
    store.setReviewed("msg-1", true);
    expect(store.get("msg-1")).toEqual({ reviewed: true, hidden: false });

    store.setReviewed("msg-1", false);
    expect(store.get("msg-1")).toEqual({ reviewed: false, hidden: false });
  });

  it("setHidden does not clobber a separately-set reviewed flag", () => {
    store.setReviewed("msg-1", true);
    store.setHidden("msg-1", true);
    expect(store.get("msg-1")).toEqual({ reviewed: true, hidden: true });
  });

  it("getAll returns every stored state, keyed by message id", () => {
    store.setReviewed("msg-1", true);
    store.setHidden("msg-2", true);

    const all = store.getAll();
    expect(all.get("msg-1")).toEqual({ reviewed: true, hidden: false });
    expect(all.get("msg-2")).toEqual({ reviewed: false, hidden: true });
    expect(all.has("msg-3")).toBe(false);
  });

  it("has no DELETE statement anywhere in its source — a hide/unreview is always an update, never a row removal", () => {
    const source = readFileSync(join(__dirname, "../../../src/vault/triage-state.ts"), "utf8");
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(/\bDELETE\s+FROM\b/i.test(codeOnly)).toBe(false);
  });
});
