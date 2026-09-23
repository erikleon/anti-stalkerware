import { describe, expect, it } from "vitest";
import { bandOf, countByBucket, listTriageRows, matchesBucket, type TriageRow } from "../../../src/triage/view";
import type { ThreadSummary, VaultStore } from "../../../src/vault/store";
import type { TriageStateStore } from "../../../src/vault/triage-state";

function buildThread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    threadId: "thread-a",
    sender: "stalker@example.com",
    latestMessageId: "msg-1",
    latestText: "hello",
    latestSentAt: new Date("2026-01-01T00:00:00Z"),
    messageCount: 1,
    maxToxicityScore: 0,
    crossesAbuseThreshold: false,
    ...overrides,
  };
}

function fakeVault(threads: ThreadSummary[]): VaultStore {
  return {
    append: async () => undefined,
    get: async () => undefined,
    list: async () => [],
    listThreads: async () => threads,
    getRawRecord: async () => undefined,
    isAbusiveSender: async () => false,
    recordQuarantine: async () => undefined,
    listQuarantined: async () => [],
  };
}

function fakeTriageState(states: Map<string, { reviewed: boolean; hidden: boolean }> = new Map()): TriageStateStore {
  return {
    get: (id: string) => states.get(id) ?? { reviewed: false, hidden: false },
    getAll: () => states,
    setReviewed: () => undefined,
    setHidden: () => undefined,
  } as unknown as TriageStateStore;
}

describe("bandOf", () => {
  it("is high when the thread crossed the abuse threshold, regardless of score", () => {
    expect(bandOf({ maxToxicityScore: 0.1, crossesAbuseThreshold: true })).toBe("high");
  });

  it("is medium above the floor but below the abuse threshold", () => {
    expect(bandOf({ maxToxicityScore: 0.5, crossesAbuseThreshold: false })).toBe("medium");
  });

  it("is none below the medium floor", () => {
    expect(bandOf({ maxToxicityScore: 0.1, crossesAbuseThreshold: false })).toBe("none");
  });
});

describe("matchesBucket", () => {
  const needsReview: Pick<TriageRow, "reviewed" | "hidden"> = { reviewed: false, hidden: false };
  const reviewed: Pick<TriageRow, "reviewed" | "hidden"> = { reviewed: true, hidden: false };
  const hidden: Pick<TriageRow, "reviewed" | "hidden"> = { reviewed: false, hidden: true };

  it("needs-review excludes reviewed and hidden rows", () => {
    expect(matchesBucket(needsReview, "needs-review")).toBe(true);
    expect(matchesBucket(reviewed, "needs-review")).toBe(false);
    expect(matchesBucket(hidden, "needs-review")).toBe(false);
  });

  it("reviewed matches only reviewed rows", () => {
    expect(matchesBucket(reviewed, "reviewed")).toBe(true);
    expect(matchesBucket(needsReview, "reviewed")).toBe(false);
  });

  it("all matches every row, hidden included", () => {
    expect(matchesBucket(needsReview, "all")).toBe(true);
    expect(matchesBucket(reviewed, "all")).toBe(true);
    expect(matchesBucket(hidden, "all")).toBe(true);
  });
});

describe("listTriageRows", () => {
  it("merges thread summaries with their persisted view-state and assigns a band", async () => {
    const vault = fakeVault([buildThread({ latestMessageId: "msg-1", crossesAbuseThreshold: true, maxToxicityScore: 0.9 })]);
    const states = new Map([["msg-1", { reviewed: true, hidden: false }]]);

    const rows = await listTriageRows(vault, fakeTriageState(states));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reviewed).toBe(true);
    expect(rows[0]?.hidden).toBe(false);
    expect(rows[0]?.band).toBe("high");
  });

  it("defaults to unreviewed, unhidden when no state was ever recorded for that message", async () => {
    const vault = fakeVault([buildThread({ latestMessageId: "msg-new" })]);
    const rows = await listTriageRows(vault, fakeTriageState());
    expect(rows[0]?.reviewed).toBe(false);
    expect(rows[0]?.hidden).toBe(false);
  });
});

describe("countByBucket", () => {
  it("counts rows per bucket independently", () => {
    const rows: TriageRow[] = [
      { ...buildThread({ threadId: "t1" }), reviewed: false, hidden: false, band: "high" },
      { ...buildThread({ threadId: "t2" }), reviewed: true, hidden: false, band: "none" },
      { ...buildThread({ threadId: "t3" }), reviewed: false, hidden: true, band: "medium" },
    ];

    expect(countByBucket(rows)).toEqual({ "needs-review": 1, reviewed: 1, all: 3 });
  });
});
