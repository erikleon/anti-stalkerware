import { describe, expect, it } from "vitest";
import { canUnlockOsint, normalizeIdentifier } from "../../src/osint/unlock";
import type { VaultStore } from "../../src/vault/store";

function fakeVault(abusiveSenders: string[]): VaultStore {
  return {
    append: async () => undefined,
    get: async () => undefined,
    list: async () => [],
    getRawRecord: async () => undefined,
    isAbusiveSender: async (sender) => abusiveSenders.includes(sender),
  };
}

describe("canUnlockOsint — the gate in front of OSINT", () => {
  it("allows a sender who is flagged abusive in the vault", async () => {
    const vault = fakeVault(["stalker@example.com"]);
    await expect(canUnlockOsint("stalker@example.com", vault)).resolves.toBe(true);
  });

  it("refuses a sender who never sent a flagged message", async () => {
    const vault = fakeVault(["stalker@example.com"]);
    await expect(canUnlockOsint("random-person@example.com", vault)).resolves.toBe(false);
  });

  it("refuses an arbitrary identifier that isn't in the vault at all", async () => {
    const vault = fakeVault([]);
    await expect(canUnlockOsint("anyone@example.com", vault)).resolves.toBe(false);
  });
});

describe("normalizeIdentifier — closes case/whitespace/unicode bypass attempts", () => {
  it("lowercases and trims", () => {
    expect(normalizeIdentifier("  Stalker@Example.com  ")).toBe("stalker@example.com");
  });

  it("normalizes unicode so a homoglyph doesn't silently mismatch the vault's stored form", () => {
    // "e" here is combined with a combining acute accent (U+0065 U+0301),
    // NFKC normalization collapses it to the same precomposed form.
    const combining = "stalkeré@example.com";
    const precomposed = "stalkeré@example.com";
    expect(normalizeIdentifier(combining)).toBe(normalizeIdentifier(precomposed));
  });
});
