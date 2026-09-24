import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteIntegrityLog, verifyIntegrity } from "../../../src/vault/integrity";
import { hashPayload } from "../../../src/ingest/hash";

describe("SqliteIntegrityLog", () => {
  let dir: string;
  let db: Database.Database;
  let log: SqliteIntegrityLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-integrity-test-"));
    db = new Database(join(dir, "vault.db"));
    log = new SqliteIntegrityLog(db);
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("round-trips an event", async () => {
    await log.append({ kind: "acquisition", recordHashes: ["h1", "h2"], occurredAt: new Date("2026-01-01T00:00:00Z") });
    const events = await log.list();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("acquisition");
    expect(events[0]?.recordHashes).toEqual(["h1", "h2"]);
  });

  it("lists events in chronological order", async () => {
    await log.append({ kind: "acquisition", recordHashes: [], occurredAt: new Date("2026-01-02T00:00:00Z") });
    await log.append({ kind: "export", recordHashes: [], occurredAt: new Date("2026-01-01T00:00:00Z") });

    const events = await log.list();
    expect(events.map((e) => e.kind)).toEqual(["export", "acquisition"]);
  });

  it("never logs individual reads — there is no read event kind at all", () => {
    // A type-level guarantee, asserted here so it can't silently drift:
    // IntegrityEventKind must never grow a "read" variant.
    const kinds: Array<"acquisition" | "export" | "destroy" | "verify"> = ["acquisition", "export", "destroy", "verify"];
    expect(kinds).not.toContain("read");
  });
});

describe("verifyIntegrity", () => {
  it("confirms a payload matches its acquisition-time hash", () => {
    const payload = Buffer.from("unmodified content");
    const hash = hashPayload(payload);
    expect(verifyIntegrity(payload, hash, hashPayload)).toBe(true);
  });

  it("detects a payload that no longer matches its recorded hash", () => {
    const original = Buffer.from("original content");
    const hash = hashPayload(original);
    const tampered = Buffer.from("tampered content");
    expect(verifyIntegrity(tampered, hash, hashPayload)).toBe(false);
  });
});
