import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { destroyVault, DESTROY_CONFIRMATION_PHRASE, DESTROY_DISCLOSURE_TEXT } from "../../../src/vault/destroy";

describe("destroyVault", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-destroy-test-"));
    writeFileSync(join(dir, "vault.db"), "db contents");
    writeFileSync(join(dir, "vault.db-wal"), "wal contents");
    writeFileSync(join(dir, "vault.meta.json"), "{}");
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  it("removes the vault's own files when the confirmation matches", async () => {
    const result = await destroyVault(dir, {
      expectedPhrase: DESTROY_CONFIRMATION_PHRASE,
      typedPhrase: DESTROY_CONFIRMATION_PHRASE,
    });

    expect(existsSync(join(dir, "vault.db"))).toBe(false);
    expect(existsSync(join(dir, "vault.db-wal"))).toBe(false);
    expect(existsSync(join(dir, "vault.meta.json"))).toBe(false);
    expect(result.filesRemoved).toHaveLength(3);
  });

  it("refuses to delete anything when the confirmation doesn't match", async () => {
    await expect(
      destroyVault(dir, { expectedPhrase: DESTROY_CONFIRMATION_PHRASE, typedPhrase: "close enough" }),
    ).rejects.toThrow(/did not match/);

    expect(existsSync(join(dir, "vault.db"))).toBe(true);
    expect(existsSync(join(dir, "vault.meta.json"))).toBe(true);
  });

  it("does not error when a file (e.g. vault.db-shm) doesn't exist", async () => {
    // vault.db-shm was never created in this fixture — destroyVault must
    // tolerate a missing sibling file rather than throw.
    await expect(
      destroyVault(dir, { expectedPhrase: DESTROY_CONFIRMATION_PHRASE, typedPhrase: DESTROY_CONFIRMATION_PHRASE }),
    ).resolves.not.toThrow();
  });

  it("the disclosure text names every backup surface it can't reach", () => {
    for (const surface of ["Time Machine", "iCloud", "APFS snapshots", "drive itself"]) {
      expect(DESTROY_DISCLOSURE_TEXT).toContain(surface);
    }
  });
});
