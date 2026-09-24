import { describe, expect, it } from "vitest";
import { compareWithKnownAccounts } from "../../src/osint/known-accounts";
import { rankCandidates } from "../../src/osint/rank";
import type { Message } from "../../src/types/message";
import type { StoredKnownAccount } from "../../src/vault/known-accounts";

function account(personLabel: string, kind: StoredKnownAccount["kind"], value: string): StoredKnownAccount {
  return { id: `${personLabel}-${value}`, personLabel, kind, value, origin: "manual", addedAt: new Date("2026-01-01T00:00:00Z") };
}

function message(sender: string, text: string, fromSelf = false): Message {
  return {
    id: `msg-${Math.random()}`,
    rawRecordHash: "hash",
    source: "imessage",
    threadId: sender,
    sender,
    fromSelf,
    text,
    sentAt: new Date("2026-02-01T00:00:00Z"),
    provenance: "live",
  };
}

const EX_OLD_NUMBER = "+15551234567";
const NEW_NUMBER = "+15559990000";

const EX_HISTORY = [
  message(EX_OLD_NUMBER, "actually i really don't think you understand what is happening here because like this is really serious and you should know that"),
  message(EX_OLD_NUMBER, "just so you know i am actually watching you all the time and you really cannot hide from me because i am always around"),
  message(EX_OLD_NUMBER, "you blocked me? that's fine", true),
];

const NEW_SENDER_MESSAGES = [
  message(NEW_NUMBER, "actually i really think you should just listen because like i am really trying to explain this and you actually need to understand"),
  message(NEW_NUMBER, "i am really serious about this whole thing and you should really just pay attention to what i am actually saying, blocking 555-123-4567 changed nothing"),
];

describe("compareWithKnownAccounts", () => {
  it("returns one candidate per person, with every identifier and a writing comparison against their vault history", () => {
    const known = [account("my ex", "phone", EX_OLD_NUMBER), account("my ex", "email", "ex@example.com")];
    const candidates = compareWithKnownAccounts(known, NEW_NUMBER, NEW_SENDER_MESSAGES, new Map([[EX_OLD_NUMBER, EX_HISTORY]]));

    expect(candidates).toHaveLength(1);
    const [ex] = candidates;
    expect(ex!.id).toBe("my ex");
    const kinds = ex!.signals.map((s) => s.kind).sort();
    expect(kinds).toEqual(["phone-reuse", "writing-style-match"]);

    const phone = ex!.signals.find((s) => s.kind === "phone-reuse")!;
    expect(phone.confidence).toBe(0.7);
    expect(phone.source).toContain(EX_OLD_NUMBER);
    const style = ex!.signals.find((s) => s.kind === "writing-style-match")!;
    expect(style.source).toContain(`from ${EX_OLD_NUMBER} in your vault`);
    expect(ex!.signals.every((s) => s.candidateId === "my ex")).toBe(true);
  });

  it("leaves the user's own replies out of a person's writing baseline", () => {
    const known = [account("my ex", "phone", EX_OLD_NUMBER)];
    const onlyOwnReplies = [message(EX_OLD_NUMBER, "a long reply i wrote myself ".repeat(20), true)];
    const [ex] = compareWithKnownAccounts(known, NEW_NUMBER, NEW_SENDER_MESSAGES, new Map([[EX_OLD_NUMBER, onlyOwnReplies]]));
    expect(ex!.signals.some((s) => s.kind === "writing-style-match")).toBe(false);
  });

  it("never compares a sender's writing with its own messages", () => {
    const known = [account("my ex", "phone", NEW_NUMBER)];
    const [ex] = compareWithKnownAccounts(known, NEW_NUMBER, NEW_SENDER_MESSAGES, new Map([[NEW_NUMBER, NEW_SENDER_MESSAGES]]));
    // The sender IS a known account — that's an identifier match, not a style one.
    expect(ex!.signals.map((s) => s.kind)).toEqual(["phone-reuse"]);
    expect(ex!.signals[0]!.confidence).toBe(0.9);
  });

  it("keeps a person with nothing in common as a zero-score candidate, not a dropped one", () => {
    const known = [account("my ex", "phone", EX_OLD_NUMBER), account("old roommate", "username", "roomie_22")];
    const ranked = rankCandidates(compareWithKnownAccounts(known, NEW_NUMBER, NEW_SENDER_MESSAGES, new Map([[EX_OLD_NUMBER, EX_HISTORY]])));
    expect(ranked.map((r) => r.candidateId)).toEqual(["my ex", "old roommate"]);
    expect(ranked[1]!.score).toBe(0);
  });

  it("returns nothing when there are no known accounts", () => {
    expect(compareWithKnownAccounts([], NEW_NUMBER, NEW_SENDER_MESSAGES, new Map())).toEqual([]);
  });
});
