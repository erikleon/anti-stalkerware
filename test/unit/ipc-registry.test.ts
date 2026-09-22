import { describe, expect, it } from "vitest";
import { listRegisteredHandlers, registerGated, registerHandler } from "../../src/main/ipc";
import type { VaultStore } from "../../src/vault/store";

function fakeVault(abusiveSenders: string[]): VaultStore {
  return {
    append: async () => undefined,
    get: async () => undefined,
    list: async () => [],
    getRawRecord: async () => undefined,
    isAbusiveSender: async (sender) => abusiveSenders.includes(sender),
    recordQuarantine: async () => undefined,
    listQuarantined: async () => [],
  };
}

describe("IPC registry", () => {
  it("records every registered channel, gated or not", () => {
    registerHandler("ping", async () => "pong");
    registerGated("osint:lookup", (sender: string) => sender, fakeVault([]), async () => "result");

    const channels = listRegisteredHandlers().map((h) => h.channel);
    expect(channels).toContain("ping");
    expect(channels).toContain("osint:lookup");

    const osintEntry = listRegisteredHandlers().find((h) => h.channel === "osint:lookup");
    expect(osintEntry?.gated).toBe(true);
  });

  it("a gated handler refuses when the sender isn't a flagged vault contact", async () => {
    const vault = fakeVault(["stalker@example.com"]);
    const handler = registerGated(
      "osint:lookup-2",
      (sender: string) => sender,
      vault,
      async (sender: string) => `looked up ${sender}`,
    );

    await expect(handler("innocent@example.com")).rejects.toThrow(/refused/i);
  });

  it("a gated handler runs when the sender is flagged", async () => {
    const vault = fakeVault(["stalker@example.com"]);
    const handler = registerGated(
      "osint:lookup-3",
      (sender: string) => sender,
      vault,
      async (sender: string) => `looked up ${sender}`,
    );

    await expect(handler("stalker@example.com")).resolves.toBe("looked up stalker@example.com");
  });
});
