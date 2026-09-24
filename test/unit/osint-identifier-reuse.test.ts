import { describe, expect, it } from "vitest";
import { checkIdentifierReuse } from "../../src/osint/signals/identifier-reuse";
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

describe("checkIdentifierReuse", () => {
  it("matches strongly when the candidate's identifier is the sender's own identifier", () => {
    const signal = checkIdentifierReuse("email", "known.person@example.com", "known.person@example.com", []);
    expect(signal?.confidence).toBe(0.9);
    expect(signal?.kind).toBe("email-reuse");
  });

  it("matches, more weakly, when the identifier only appears inside something the sender wrote", () => {
    const messages = [buildMessage({ text: "email me at other.address@example.com if you want to talk" })];
    const signal = checkIdentifierReuse("email", "other.address@example.com", "unknown-sender@example.com", messages);
    expect(signal?.confidence).toBe(0.7);
  });

  it("does not match text the user themselves wrote, only the sender's own messages", () => {
    const messages = [buildMessage({ text: "unrelated", fromSelf: false }), buildMessage({ id: "msg-2", text: "reach me at leak@example.com", fromSelf: true })];
    const signal = checkIdentifierReuse("email", "leak@example.com", "unknown-sender@example.com", messages);
    expect(signal).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    const signal = checkIdentifierReuse("phone", "555-0100", "unknown-sender@example.com", [buildMessage()]);
    expect(signal).toBeUndefined();
  });

  it("normalizes case and whitespace before comparing, same as the OSINT gate itself", () => {
    const signal = checkIdentifierReuse("username", "  ExampleHandle  ", "examplehandle@example.com", []);
    expect(signal?.confidence).toBe(0.9);
  });

  it("returns undefined for a blank candidate value rather than matching everything", () => {
    const signal = checkIdentifierReuse("username", "   ", "anything@example.com", []);
    expect(signal).toBeUndefined();
  });
});
