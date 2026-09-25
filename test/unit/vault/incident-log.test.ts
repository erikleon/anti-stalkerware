import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { removeTestDir } from "../../helpers/tmp-dir";
import { createVaultMetadata, ScryptGcmVaultCrypto, type VaultKey } from "../../../src/vault/crypto";
import { IncidentLogStore } from "../../../src/vault/incident-log";

const INCIDENT = {
  occurredAt: new Date("2026-11-01T06:30:00.000Z"),
  occurredLocal: "2026-11-01T01:30:00.000-05:00[America/New_York]",
  involving: "Jordan",
  html: "<p>Showed up at the <strong>school pickup</strong> after being told not to.</p>",
  text: "Showed up at the school pickup after being told not to.",
};

describe("IncidentLogStore", () => {
  let key: VaultKey;
  let dir: string;
  let dbPath: string;
  let db: Database.Database;
  let store: IncidentLogStore;

  beforeAll(async () => {
    // One scrypt derivation for the whole file: it's slow on purpose.
    key = await new ScryptGcmVaultCrypto(createVaultMetadata("pass")).unlock("pass");
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-incident-log-test-"));
    dbPath = join(dir, "vault.db");
    db = new Database(dbPath);
    store = new IncidentLogStore(db, key);
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("starts empty", () => {
    expect(store.list()).toEqual([]);
  });

  it("add round-trips every field, with the device's written time as revision 1", () => {
    const writtenAt = new Date("2026-11-01T12:00:00.000Z");
    const added = store.add(INCIDENT, writtenAt);
    expect(added).toMatchObject({
      occurredAt: INCIDENT.occurredAt,
      occurredLocal: INCIDENT.occurredLocal,
      involving: "Jordan",
      revisions: [{ revision: 1, writtenAt, html: INCIDENT.html, text: INCIDENT.text }],
    });
    expect(store.list()).toEqual([added]);
  });

  it("encrypts the text, the local time, and who was involved at rest", () => {
    store.add(INCIDENT);
    db.close();
    const bytes = readFileSync(dbPath).toString("latin1");
    for (const secret of ["school pickup", "Jordan", "America/New_York"]) expect(bytes).not.toContain(secret);
    db = new Database(dbPath);
  });

  it("revise adds a revision and keeps every earlier one", () => {
    const added = store.add(INCIDENT, new Date("2026-11-01T12:00:00.000Z"));
    const revised = store.revise(added.id, "<p>Updated.</p>", "Updated.", new Date("2026-11-02T09:00:00.000Z"));
    expect(revised.revisions.map((r) => [r.revision, r.text])).toEqual([
      [1, INCIDENT.text],
      [2, "Updated."],
    ]);
    expect(revised.occurredLocal).toBe(INCIDENT.occurredLocal);
  });

  it("revise with unchanged text adds nothing", () => {
    const added = store.add(INCIDENT);
    expect(store.revise(added.id, INCIDENT.html, INCIDENT.text).revisions).toHaveLength(1);
  });

  it("refuses an empty description, and a revision of an entry that doesn't exist", () => {
    expect(() => store.add({ ...INCIDENT, text: "  " })).toThrow(/needs a description/);
    expect(() => store.revise("nope", "<p>x</p>", "x")).toThrow(/no incident/);
  });

  it("leaves out an empty involving field", () => {
    const added = store.add({ ...INCIDENT, involving: "  " });
    expect(added.involving).toBeUndefined();
  });

  it("lists the most recent incident first, by when it happened, not when it was written", () => {
    store.add({ ...INCIDENT, occurredAt: new Date("2026-01-01T00:00:00Z"), text: "older" }, new Date("2026-12-01T00:00:00Z"));
    store.add({ ...INCIDENT, occurredAt: new Date("2026-06-01T00:00:00Z"), text: "newer" }, new Date("2026-06-02T00:00:00Z"));
    expect(store.list().map((e) => e.revisions[0]!.text)).toEqual(["newer", "older"]);
  });

  it("has no way to delete an entry", () => {
    expect("remove" in store || "delete" in store).toBe(false);
  });
});
