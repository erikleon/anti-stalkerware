import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeVault, openVault, vaultExists, VaultMetadataError, type Vault } from "../../../src/vault/vault";

describe("initializeVault + openVault", () => {
  let dir: string;
  let vault: Vault | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-vault-e2e-test-"));
  });

  afterEach(() => {
    vault?.close();
    vault = undefined;
    removeTestDir(dir);
  });

  it("opens a freshly initialized vault with the same passphrase", async () => {
    await initializeVault(dir, "my passphrase");
    vault = await openVault(dir, "my passphrase");
    expect(vault.store).toBeDefined();
    expect(vault.credentials).toBeDefined();
    expect(vault.integrityLog).toBeDefined();
  });

  it("refuses to open with the wrong passphrase", async () => {
    await initializeVault(dir, "correct passphrase");
    await expect(openVault(dir, "wrong passphrase")).rejects.toThrow(/failed to unlock vault/);
  });

  it("refuses to initialize twice over the same directory", async () => {
    await initializeVault(dir, "first passphrase");
    await expect(initializeVault(dir, "second passphrase")).rejects.toThrow(/already exists/);
  });

  it("vaultExists reflects whether initialization has happened", async () => {
    expect(vaultExists(dir)).toBe(false);
    await initializeVault(dir, "pass");
    expect(vaultExists(dir)).toBe(true);
  });

  it("throws a distinguishable VaultMetadataError when no vault exists at all — not the generic unlock failure", async () => {
    await expect(openVault(dir, "any passphrase")).rejects.toThrow(VaultMetadataError);
  });

  it("throws a distinguishable VaultMetadataError for a corrupted (unparseable) metadata file", async () => {
    await initializeVault(dir, "pass");
    writeFileSync(join(dir, "vault.meta.json"), "not valid json{{{");
    await expect(openVault(dir, "pass")).rejects.toThrow(VaultMetadataError);
  });

  it("the store, credentials, and integrity log all work together after opening", async () => {
    await initializeVault(dir, "pass");
    vault = await openVault(dir, "pass");

    await vault.store.append(
      {
        id: "raw-1",
        source: "imessage",
        payload: Buffer.from("raw"),
        acquiredAt: new Date(),
        hash: "hash-1",
        parserVersion: "1",
      },
      {
        id: "msg-1",
        rawRecordHash: "hash-1",
        source: "imessage",
        threadId: "thread-a",
        sender: "stalker@example.com",
        fromSelf: false,
        text: "hello",
        sentAt: new Date(),
        provenance: "live",
      },
      { crossesAbuseThreshold: true },
    );

    expect(await vault.store.isAbusiveSender("stalker@example.com")).toBe(true);

    await vault.credentials.save({ account: "victim@gmail.com", secret: "token", kind: "oauth-refresh-token" });
    expect((await vault.credentials.get("victim@gmail.com"))?.secret).toBe("token");

    await vault.integrityLog.append({ kind: "acquisition", recordHashes: ["hash-1"], occurredAt: new Date() });
    expect(await vault.integrityLog.list()).toHaveLength(1);
  });

  it("data persists across separate open sessions", async () => {
    await initializeVault(dir, "pass");
    const first = await openVault(dir, "pass");
    await first.store.append(
      { id: "raw-1", source: "imessage", payload: Buffer.from("raw"), acquiredAt: new Date(), hash: "hash-1", parserVersion: "1" },
      { id: "msg-1", rawRecordHash: "hash-1", source: "imessage", threadId: "thread-a", sender: "s", fromSelf: false, text: "persisted", sentAt: new Date(), provenance: "live" },
    );
    first.close();

    vault = await openVault(dir, "pass");
    const fetched = await vault.store.get("msg-1");
    expect(fetched?.text).toBe("persisted");
  });
});
