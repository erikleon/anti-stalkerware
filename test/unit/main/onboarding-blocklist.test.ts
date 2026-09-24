import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { removeTestDir } from "../../helpers/tmp-dir";
import { KnownAccountStore } from "../../../src/vault/known-accounts";
import { annotateSweep, importMacosBlocklist, loadBlocklist, saveBlockedAsKnown } from "../../../src/main/onboarding";
import type { BlocklistReadResult } from "../../../src/ingest/blocklist/macos-blocklist";

const sweepRow = (sender: string) => ({
  sender,
  messageCount: 3,
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-02-01T00:00:00Z"),
});

const blocklistWith = (result: BlocklistReadResult) => async () => result;

describe("onboarding and the macOS block list", () => {
  let dir: string;
  let db: Database.Database;
  let knownAccounts: KnownAccountStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-onboarding-blocklist-test-"));
    db = new Database(join(dir, "vault.db"));
    knownAccounts = new KnownAccountStore(db);
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("marks a scanned sender that is blocked on this Mac, in any phone format", () => {
    const response = annotateSweep(
      [sweepRow("(555) 123-4567"), sweepRow("+15550001111")],
      knownAccounts,
      [{ kind: "phone", value: "+15551234567", on: "macos" }],
      { status: "ok", blockedCount: 1, skipped: 0 },
    );
    expect(response.rows.map((r) => r.blockedOn)).toEqual(["macos", undefined]);
    expect(response.blocklist.blockedCount).toBe(1);
  });

  it("marks a blocked email sender too, so it works for IMAP", () => {
    const response = annotateSweep([sweepRow("Ex@Example.com")], knownAccounts, [{ kind: "email", value: "ex@example.com", on: "macos" }], {
      status: "ok",
      blockedCount: 1,
      skipped: 0,
    });
    expect(response.rows[0]!.blockedOn).toBe("macos");
  });

  it("labels a sender that's already a known account with the person's name", () => {
    knownAccounts.add({ personLabel: "my ex", kind: "phone", value: "+15551234567", origin: "manual" });
    const response = annotateSweep([sweepRow("+15551234567")], knownAccounts, [], { status: "not-found", blockedCount: 0, skipped: 0 });
    expect(response.rows[0]!.knownAccountLabel).toBe("my ex");
    expect(response.rows[0]!.blockedOn).toBeUndefined();
  });

  it("matches an Instagram block list username against a sender's alias, not just their display name", () => {
    const row = { ...sweepRow("Alex B"), aliases: ["alex_b"] };
    const response = annotateSweep([row, sweepRow("Sam")], knownAccounts, [{ kind: "username", value: "Alex_B", on: "instagram" }], {
      status: "unsupported-platform",
      blockedCount: 0,
      skipped: 0,
    });
    expect(response.rows.map((r) => r.blockedOn)).toEqual(["instagram", undefined]);
  });

  it("loadBlocklist turns a read failure into a visible status instead of failing the scan", async () => {
    const failing = async (): Promise<BlocklistReadResult> => {
      throw new Error("permission denied");
    };
    const { summary, entries } = await loadBlocklist(failing);
    expect(summary).toEqual({ status: "error", blockedCount: 0, skipped: 0, error: "permission denied" });
    expect(entries).toEqual([]);
  });

  it("saveBlockedAsKnown only saves identifiers that really are on the block list", async () => {
    const read = blocklistWith({ status: "ok", entries: [{ kind: "phone", value: "+15551234567" }], skipped: 0 });
    const result = await saveBlockedAsKnown(knownAccounts, ["+15551234567", "+15550001111"], read);
    expect(result).toEqual({ added: 1, alreadyKnown: 0 });
    const [saved] = knownAccounts.list();
    expect(saved).toMatchObject({ personLabel: "+15551234567", kind: "phone", origin: "macos-blocklist" });
  });

  it("importMacosBlocklist adds every entry as its own person and reports what it skipped", async () => {
    const read = blocklistWith({
      status: "ok",
      entries: [
        { kind: "phone", value: "+15551234567" },
        { kind: "email", value: "ex@example.com" },
      ],
      skipped: 2,
    });
    const result = await importMacosBlocklist(knownAccounts, read);
    expect(result).toEqual({ status: "ok", blockedCount: 2, skipped: 2, added: 2, alreadyKnown: 0 });
    expect(new Set(knownAccounts.list().map((a) => a.personLabel)).size).toBe(2);

    const again = await importMacosBlocklist(knownAccounts, read);
    expect(again).toMatchObject({ added: 0, alreadyKnown: 2 });
  });

  it("importMacosBlocklist surfaces a read failure as an error", async () => {
    const failing = async (): Promise<BlocklistReadResult> => {
      throw new Error("the macOS block list has an unexpected layout");
    };
    await expect(importMacosBlocklist(knownAccounts, failing)).rejects.toThrow(/unexpected layout/);
  });

  it("importMacosBlocklist reports an unsupported platform without adding anything", async () => {
    const result = await importMacosBlocklist(knownAccounts, blocklistWith({ status: "unsupported-platform" }));
    expect(result).toMatchObject({ status: "unsupported-platform", added: 0 });
    expect(knownAccounts.list()).toEqual([]);
  });
});
