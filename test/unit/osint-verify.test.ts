import { describe, expect, it } from "vitest";
import { buildCandidate } from "../../src/osint/verify";
import type { CandidateInput } from "../../src/osint/candidate-input";
import type { Message } from "../../src/types/message";

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    rawRecordHash: "hash-1",
    source: "imap",
    threadId: "thread-a",
    sender: "unknown-sender@example.com",
    fromSelf: false,
    text: "you'll never find me",
    sentAt: new Date("2026-01-01T00:00:00Z"),
    provenance: "live",
    ...overrides,
  };
}

describe("buildCandidate", () => {
  it("only checks fields the user actually filled in", () => {
    const input: CandidateInput = { label: "Jordan", username: "jordan_handle" };
    const candidate = buildCandidate(input, "jordan_handle@example.com", []);
    // username matches the sender identifier; email/phone/writingSample were never supplied, so no attempt is made at them.
    expect(candidate.signals).toHaveLength(1);
    expect(candidate.signals[0]?.kind).toBe("username-reuse");
  });

  it("produces zero signals, not an error, when nothing the user supplied is supported", () => {
    const input: CandidateInput = { label: "A wrong guess", email: "nobody@example.com" };
    const candidate = buildCandidate(input, "unknown-sender@example.com", [buildMessage()]);
    expect(candidate.signals).toHaveLength(0);
  });

  it("stamps every signal with the candidate's own id, not the sender's", () => {
    const input: CandidateInput = { label: "Jordan", email: "jordan@example.com" };
    const candidate = buildCandidate(input, "jordan@example.com", []);
    expect(candidate.signals[0]?.candidateId).toBe("Jordan");
  });

  it("falls back to a placeholder label rather than an empty candidate id", () => {
    const input: CandidateInput = { label: "   ", email: "jordan@example.com" };
    const candidate = buildCandidate(input, "jordan@example.com", []);
    expect(candidate.id).toBe("unnamed candidate");
  });

  it("can combine multiple supplied fields into multiple supporting signals for one candidate", () => {
    const input: CandidateInput = { label: "Jordan", username: "jordan_handle", email: "jordan@example.com" };
    const messages = [buildMessage({ text: "you can reach me at jordan@example.com if you need to" })];
    const candidate = buildCandidate(input, "jordan_handle@example.com", messages);
    expect(candidate.signals.map((s) => s.kind).sort()).toEqual(["email-reuse", "username-reuse"]);
  });
});
