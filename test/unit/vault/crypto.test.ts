import { describe, expect, it } from "vitest";
import { createVaultMetadata, ScryptGcmVaultCrypto } from "../../../src/vault/crypto";

describe("createVaultMetadata + ScryptGcmVaultCrypto", () => {
  it("unlocks with the correct passphrase", async () => {
    const metadata = createVaultMetadata("correct horse battery staple");
    const crypto = new ScryptGcmVaultCrypto(metadata);
    const key = await crypto.unlock("correct horse battery staple");
    expect(key).toBeDefined();
  });

  it("round-trips plaintext through encrypt/decrypt", async () => {
    const metadata = createVaultMetadata("my passphrase");
    const crypto = new ScryptGcmVaultCrypto(metadata);
    const key = await crypto.unlock("my passphrase");

    const plaintext = Buffer.from("you can't hide from me", "utf8");
    const ciphertext = key.encrypt(plaintext);
    expect(ciphertext).not.toEqual(plaintext);
    expect(key.decrypt(ciphertext)).toEqual(plaintext);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", async () => {
    const metadata = createVaultMetadata("my passphrase");
    const crypto = new ScryptGcmVaultCrypto(metadata);
    const key = await crypto.unlock("my passphrase");

    const plaintext = Buffer.from("same message", "utf8");
    expect(key.encrypt(plaintext)).not.toEqual(key.encrypt(plaintext));
  });

  it("rejects a wrong passphrase", async () => {
    const metadata = createVaultMetadata("correct passphrase");
    const crypto = new ScryptGcmVaultCrypto(metadata);
    await expect(crypto.unlock("wrong passphrase")).rejects.toThrow(/failed to unlock vault/);
  });

  it("wrong passphrase and a corrupted canary throw the identical error message", async () => {
    const metadata = createVaultMetadata("correct passphrase");

    const wrongPassphraseError = await new ScryptGcmVaultCrypto(metadata)
      .unlock("wrong passphrase")
      .catch((e: Error) => e.message);

    const corrupted = { ...metadata, canary: flipOneHexNibble(metadata.canary) };
    const corruptedVaultError = await new ScryptGcmVaultCrypto(corrupted)
      .unlock("correct passphrase")
      .catch((e: Error) => e.message);

    expect(wrongPassphraseError).toBe(corruptedVaultError);
  });

  it("wrong passphrase and a corrupted canary take roughly the same time (both pay the full scrypt cost)", async () => {
    const metadata = createVaultMetadata("correct passphrase");
    const corrupted = { ...metadata, canary: flipOneHexNibble(metadata.canary) };

    const timeOf = async (fn: () => Promise<unknown>) => {
      const start = performance.now();
      await fn().catch(() => undefined);
      return performance.now() - start;
    };

    const wrongPassTime = await timeOf(() => new ScryptGcmVaultCrypto(metadata).unlock("wrong passphrase"));
    const corruptedTime = await timeOf(() => new ScryptGcmVaultCrypto(corrupted).unlock("correct passphrase"));

    // Generous tolerance — this isn't a rigorous timing-attack audit, just
    // a check that one path isn't obviously short-circuiting the other by
    // skipping the scrypt derivation.
    expect(Math.abs(wrongPassTime - corruptedTime)).toBeLessThan(Math.max(wrongPassTime, corruptedTime) * 0.5);
  });

  it("currentKey() reflects unlock/lock state", async () => {
    const metadata = createVaultMetadata("pass");
    const crypto = new ScryptGcmVaultCrypto(metadata);
    expect(crypto.currentKey()).toBeUndefined();

    await crypto.unlock("pass");
    expect(crypto.currentKey()).toBeDefined();

    await crypto.lock();
    expect(crypto.currentKey()).toBeUndefined();
  });
});

function flipOneHexNibble(hex: string): string {
  const midpoint = Math.floor(hex.length / 2);
  const chars = hex.split("");
  const original = chars[midpoint]!;
  chars[midpoint] = original === "0" ? "1" : "0";
  return chars.join("");
}
