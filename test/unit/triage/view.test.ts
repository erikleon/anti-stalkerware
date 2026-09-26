import { describe, expect, it } from "vitest";
import { bandOf, countByBucket, listTriageRows, matchesBucket, type TriageRow } from "../../../src/triage/view";
import type { Message } from "../../../src/types/message";
import type { ThreadSummary, VaultStore } from "../../../src/vault/store";
import type { TriageStateStore } from "../../../src/vault/triage-state";
import type { StoredBoundary, StoredTaggedPhrase, UserContextStore } from "../../../src/vault/user-context";

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

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    rawRecordHash: "hash-1",
    source: "imessage",
    threadId: "thread-a",
    sender: "stalker@example.com",
    fromSelf: false,
    text: "hello",
    sentAt: new Date("2026-01-01T00:00:00Z"),
    provenance: "live",
    ...overrides,
  };
}

function fakeVault(threads: ThreadSummary[], messagesByThread: Record<string, Message[]> = {}): VaultStore {
  return {
    append: async () => undefined,
    get: async () => undefined,
    list: async (threadId: string) => messagesByThread[threadId] ?? [],
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

function fakeUserContext(boundaries: StoredBoundary[] = [], taggedPhrases: StoredTaggedPhrase[] = []): UserContextStore {
  return {
    listBoundaries: () => boundaries,
    listTaggedPhrases: () => taggedPhrases,
  } as unknown as UserContextStore;
}

describe("bandOf", () => {
  it("is high when the thread crossed the abuse threshold, regardless of score", () => {
    expect(bandOf({ maxToxicityScore: 0.1, crossesAbuseThreshold: true })).toBe("high");
  });

  it("is medium above the floor but below the abuse threshold", () => {
    expect(bandOf({ maxToxicityScore: 0.5, crossesAbuseThreshold: false })).toBe("medium");
  });

  it("is none below the medium floor with no structural signal", () => {
    expect(bandOf({ maxToxicityScore: 0.1, crossesAbuseThreshold: false })).toBe("none");
  });

  it("is medium when a structural signal fired even with a low score", () => {
    expect(bandOf({ maxToxicityScore: 0.1, crossesAbuseThreshold: false }, true)).toBe("medium");
  });

  it("a fired structural signal never downgrades high to medium", () => {
    expect(bandOf({ maxToxicityScore: 0.1, crossesAbuseThreshold: true }, true)).toBe("high");
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

    const rows = await listTriageRows(vault, fakeTriageState(states), fakeUserContext());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reviewed).toBe(true);
    expect(rows[0]?.hidden).toBe(false);
    expect(rows[0]?.band).toBe("high");
    expect(rows[0]?.signalDetails).toEqual([]);
  });

  it("says in words why the toxicity model flagged a thread", async () => {
    const vault = fakeVault([buildThread({ crossesAbuseThreshold: true, maxToxicityScore: 0.86, maxToxicityLabel: "threat" })]);
    const rows = await listTriageRows(vault, fakeTriageState(), fakeUserContext());
    expect(rows[0]?.signalDetails).toEqual(["Toxicity model: reads as a threat (86%)"]);
  });

  it("gives no model reason below the Medium band", async () => {
    const vault = fakeVault([buildThread({ maxToxicityScore: 0.2, maxToxicityLabel: "toxic" })]);
    const rows = await listTriageRows(vault, fakeTriageState(), fakeUserContext());
    expect(rows[0]?.signalDetails).toEqual([]);
  });

  it("defaults to unreviewed, unhidden when no state was ever recorded for that message", async () => {
    const vault = fakeVault([buildThread({ latestMessageId: "msg-new" })]);
    const rows = await listTriageRows(vault, fakeTriageState(), fakeUserContext());
    expect(rows[0]?.reviewed).toBe(false);
    expect(rows[0]?.hidden).toBe(false);
  });

  it("a tagged phrase match bumps an otherwise-unscored thread to medium and surfaces why", async () => {
    const thread = buildThread({ threadId: "thread-a", latestMessageId: "msg-1", maxToxicityScore: 0, crossesAbuseThreshold: false });
    const message = buildMessage({ id: "msg-1", threadId: "thread-a", text: "I still remember peaches" });
    const vault = fakeVault([thread], { "thread-a": [message] });
    const userContext = fakeUserContext([], [{ id: "p1", phrase: "peaches", note: "our old nickname, only they'd use it" }]);

    const rows = await listTriageRows(vault, fakeTriageState(), userContext);
    expect(rows[0]?.band).toBe("medium");
    expect(rows[0]?.signalDetails).toHaveLength(1);
    expect(rows[0]?.signalDetails[0]).toContain("peaches");
  });

  it("a boundary violation in one thread doesn't affect a different thread with no signal", async () => {
    const threadA = buildThread({ threadId: "thread-a", sender: "stalker@example.com", latestMessageId: "msg-a" });
    const threadB = buildThread({ threadId: "thread-b", sender: "friend@example.com", latestMessageId: "msg-b" });
    const messageA = buildMessage({ id: "msg-a", threadId: "thread-a", sender: "stalker@example.com", sentAt: new Date("2026-02-01T00:00:00Z") });
    const messageB = buildMessage({ id: "msg-b", threadId: "thread-b", sender: "friend@example.com", text: "hey, free for lunch?" });
    const vault = fakeVault([threadA, threadB], { "thread-a": [messageA], "thread-b": [messageB] });
    const userContext = fakeUserContext([{ id: "b1", setAt: new Date("2026-01-01T00:00:00Z"), description: "told them to stop" }]);

    const rows = await listTriageRows(vault, fakeTriageState(), userContext);
    expect(rows.find((r) => r.threadId === "thread-a")?.band).toBe("medium");
    expect(rows.find((r) => r.threadId === "thread-b")?.band).toBe("none");
  });
});

describe("countByBucket", () => {
  it("counts rows per bucket independently", () => {
    const rows: TriageRow[] = [
      { ...buildThread({ threadId: "t1" }), reviewed: false, hidden: false, band: "high", signalDetails: [] },
      { ...buildThread({ threadId: "t2" }), reviewed: true, hidden: false, band: "none", signalDetails: [] },
      { ...buildThread({ threadId: "t3" }), reviewed: false, hidden: true, band: "medium", signalDetails: [] },
    ];

    expect(countByBucket(rows)).toEqual({ "needs-review": 1, reviewed: 1, all: 3 });
  });
});
