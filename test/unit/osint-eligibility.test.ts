import { describe, expect, it } from "vitest";
import { listEligibility } from "../../src/osint/eligibility";
import type { ThreadSummary, VaultStore } from "../../src/vault/store";

function buildThread(threadId: string, sender: string): ThreadSummary {
  return {
    threadId,
    sender,
    latestMessageId: `${threadId}-latest`,
    latestText: "latest",
    latestSentAt: new Date("2026-01-01T00:00:00Z"),
    messageCount: 1,
    maxToxicityScore: 0,
    crossesAbuseThreshold: false,
  };
}

function fakeVault(threads: ThreadSummary[], abusiveSenders: string[]): VaultStore {
  return {
    append: async () => undefined,
    get: async () => undefined,
    list: async () => [],
    listThreads: async () => threads,
    getRawRecord: async () => undefined,
    isAbusiveSender: async (sender) => abusiveSenders.includes(sender),
    recordQuarantine: async () => undefined,
    listQuarantined: async () => [],
  };
}

describe("listEligibility", () => {
  it("dedupes senders across multiple threads", async () => {
    const vault = fakeVault(
      [buildThread("thread-a", "stalker@example.com"), buildThread("thread-b", "stalker@example.com")],
      [],
    );
    const eligibility = await listEligibility(vault);
    expect(eligibility).toHaveLength(1);
  });

  it("marks a sender eligible only once they cross the abuse threshold", async () => {
    const vault = fakeVault(
      [buildThread("thread-a", "abusive@example.com"), buildThread("thread-b", "benign@example.com")],
      ["abusive@example.com"],
    );
    const eligibility = await listEligibility(vault);
    expect(eligibility.find((e) => e.sender === "abusive@example.com")?.eligible).toBe(true);
    expect(eligibility.find((e) => e.sender === "benign@example.com")?.eligible).toBe(false);
  });
});
