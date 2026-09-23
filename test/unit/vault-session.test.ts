import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultSession } from "../../src/main/vault-session";

describe("VaultSession", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-vault-session-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports no vault as not existing and not unlocked", () => {
    const session = new VaultSession(join(dir, "vault"));
    expect(session.exists()).toBe(false);
    expect(session.isUnlocked()).toBe(false);
    expect(session.current()).toBeUndefined();
  });

  it("initialize creates and immediately unlocks a fresh vault", async () => {
    const session = new VaultSession(join(dir, "vault"));
    await expect(session.initialize("correct horse battery staple")).resolves.toBe(true);
    expect(session.isUnlocked()).toBe(true);
    expect(session.exists()).toBe(true);
    session.lock();
  });

  it("unlock with the correct passphrase succeeds and lock() clears it", async () => {
    const session = new VaultSession(join(dir, "vault"));
    await session.initialize("correct horse battery staple");
    session.lock();
    expect(session.isUnlocked()).toBe(false);

    await expect(session.unlock("correct horse battery staple")).resolves.toBe(true);
    expect(session.isUnlocked()).toBe(true);
    session.lock();
  });

  it("a wrong passphrase and a corrupted vault both resolve to false, never a thrown error", async () => {
    const wrongPassDir = join(dir, "wrong-pass-vault");
    const session1 = new VaultSession(wrongPassDir);
    await session1.initialize("correct horse battery staple");
    session1.lock();
    const session1Retry = new VaultSession(wrongPassDir);
    await expect(session1Retry.unlock("incorrect passphrase")).resolves.toBe(false);
    expect(session1Retry.isUnlocked()).toBe(false);

    // Simulate a corrupted metadata file directly, bypassing initialize().
    const corruptDir = join(dir, "corrupt-vault");
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(join(corruptDir, "vault.meta.json"), "not valid json");
    const session2 = new VaultSession(corruptDir);
    await expect(session2.unlock("anything")).resolves.toBe(false);
    expect(session2.isUnlocked()).toBe(false);
  });
});
