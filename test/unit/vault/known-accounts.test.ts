import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { accountMatchesIdentifier, inferAccountKind, KnownAccountStore } from "../../../src/vault/known-accounts";

describe("KnownAccountStore", () => {
  let dir: string;
  let db: Database.Database;
  let store: KnownAccountStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-known-accounts-test-"));
    db = new Database(join(dir, "vault.db"));
    store = new KnownAccountStore(db);
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("starts empty", () => {
    expect(store.list()).toEqual([]);
  });

  it("add round-trips through list", () => {
    const added = store.add({ personLabel: "my ex", kind: "phone", value: "+15551234567", origin: "manual" });
    expect(added.id).toBeTruthy();
    expect(store.list()).toEqual([added]);
  });

  it("treats the same phone number in a different format as the same account", () => {
    const first = store.add({ personLabel: "my ex", kind: "phone", value: "+1 (555) 123-4567", origin: "manual" });
    const second = store.add({ personLabel: "someone else", kind: "phone", value: "5551234567", origin: "macos-blocklist" });
    expect(second.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);
  });

  it("re-importing a block list never overwrites a label the user set by hand", () => {
    const manual = store.add({ personLabel: "my ex", kind: "email", value: "Ex@Example.com", origin: "manual" });
    store.addMany([{ personLabel: "Blocked on this Mac", kind: "email", value: "ex@example.com", origin: "macos-blocklist" }]);
    expect(store.list()).toEqual([manual]);
  });

  it("addMany counts new and already-known rows", () => {
    store.add({ personLabel: "my ex", kind: "phone", value: "+15551234567", origin: "manual" });
    const result = store.addMany([
      { personLabel: "Blocked", kind: "phone", value: "+15551234567", origin: "macos-blocklist" },
      { personLabel: "Blocked", kind: "phone", value: "+15559876543", origin: "macos-blocklist" },
    ]);
    expect(result).toEqual({ added: 1, alreadyKnown: 1 });
  });

  it("treats @handle and handle as the same username", () => {
    store.add({ personLabel: "coworker", kind: "username", value: "@Alex_B", origin: "manual" });
    expect(store.findMatch("alex_b")?.personLabel).toBe("coworker");
  });

  it("findMatch finds a sender by any format of a known phone number", () => {
    store.add({ personLabel: "my ex", kind: "phone", value: "555-123-4567", origin: "manual" });
    expect(store.findMatch("+15551234567")?.personLabel).toBe("my ex");
    expect(store.findMatch("+15550000000")).toBeUndefined();
  });

  it("setPersonLabel relabels one row; a blank label is refused", () => {
    const added = store.add({ personLabel: "Blocked on this Mac", kind: "phone", value: "+15551234567", origin: "macos-blocklist" });
    store.setPersonLabel(added.id, "my ex");
    expect(store.list()[0]?.personLabel).toBe("my ex");
    expect(() => store.setPersonLabel(added.id, "  ")).toThrow(/person label/);
  });

  it("refuses a blank label or a value with nothing usable in it", () => {
    expect(() => store.add({ personLabel: " ", kind: "phone", value: "+15551234567", origin: "manual" })).toThrow(/person label/);
    expect(() => store.add({ personLabel: "x", kind: "phone", value: "no digits", origin: "manual" })).toThrow(/not a usable phone/);
  });

  it("remove deletes the row", () => {
    const added = store.add({ personLabel: "my ex", kind: "phone", value: "+15551234567", origin: "manual" });
    store.remove(added.id);
    expect(store.list()).toEqual([]);
  });
});

describe("inferAccountKind", () => {
  it("reads the identifier's shape", () => {
    expect(inferAccountKind("+1 (555) 123-4567")).toBe("phone");
    expect(inferAccountKind("person@example.com")).toBe("email");
    expect(inferAccountKind("alex_b")).toBe("username");
    expect(inferAccountKind("Alex B")).toBe("username");
  });
});

describe("accountMatchesIdentifier", () => {
  it("never matches across kinds, even when the digits line up", () => {
    expect(accountMatchesIdentifier({ kind: "username", value: "5551234567" }, "+15551234567")).toBe(false);
    expect(accountMatchesIdentifier({ kind: "phone", value: "5551234567" }, "+15551234567")).toBe(true);
  });
});
