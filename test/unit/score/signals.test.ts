import { describe, expect, it } from "vitest";
import {
  detectChannelSwitch,
  detectContactAfterBoundary,
  detectEscalatingFrequency,
  detectLocationOrScheduleMentions,
  detectNewCorrelatedIdentifiers,
  detectUserTaggedPhrases,
  StructuralSignalDetector,
} from "../../../src/score/signals";
import type { Message } from "../../../src/types/message";

let counter = 0;
function msg(overrides: Partial<Message> = {}): Message {
  counter++;
  return {
    id: `m${counter}`,
    rawRecordHash: `h${counter}`,
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

describe("detectContactAfterBoundary", () => {
  it("flags a message sent after an unscoped boundary", () => {
    const boundary = { setAt: new Date("2026-01-01T00:00:00Z"), description: "told him to stop" };
    const message = msg({ sentAt: new Date("2026-01-02T00:00:00Z") });
    expect(detectContactAfterBoundary([message], [boundary])).toHaveLength(1);
  });

  it("does not flag a message sent before the boundary", () => {
    const boundary = { setAt: new Date("2026-01-05T00:00:00Z"), description: "told him to stop" };
    const message = msg({ sentAt: new Date("2026-01-02T00:00:00Z") });
    expect(detectContactAfterBoundary([message], [boundary])).toHaveLength(0);
  });

  it("never flags the user's own messages", () => {
    const boundary = { setAt: new Date("2026-01-01T00:00:00Z"), description: "told him to stop" };
    const message = msg({ sentAt: new Date("2026-01-02T00:00:00Z"), fromSelf: true });
    expect(detectContactAfterBoundary([message], [boundary])).toHaveLength(0);
  });

  it("a sender-scoped boundary only applies to that sender", () => {
    const boundary = {
      setAt: new Date("2026-01-01T00:00:00Z"),
      description: "told him specifically to stop",
      appliesToSender: "stalker@example.com",
    };
    const otherSender = msg({ sender: "someone-else@example.com", sentAt: new Date("2026-01-02T00:00:00Z") });
    expect(detectContactAfterBoundary([otherSender], [boundary])).toHaveLength(0);
  });
});

describe("detectLocationOrScheduleMentions", () => {
  it("flags a message mentioning surveillance of the workplace", () => {
    const message = msg({ text: "I drove by your work today" });
    expect(detectLocationOrScheduleMentions([message])).toHaveLength(1);
  });

  it("flags a message that reveals knowledge of the victim's address", () => {
    const message = msg({ text: "nice to know your new address now" });
    expect(detectLocationOrScheduleMentions([message])).toHaveLength(1);
  });

  it("does not flag an ordinary message with no location/schedule content", () => {
    const message = msg({ text: "how are you doing today" });
    expect(detectLocationOrScheduleMentions([message])).toHaveLength(0);
  });

  it("never flags the user's own messages", () => {
    const message = msg({ text: "I drove by your work today", fromSelf: true });
    expect(detectLocationOrScheduleMentions([message])).toHaveLength(0);
  });
});

describe("detectUserTaggedPhrases", () => {
  it("flags a message containing a tagged phrase, case-insensitively", () => {
    const message = msg({ text: "remember the LAKE HOUSE?" });
    const tagged = [{ phrase: "lake house", note: "only he knows about this place" }];
    const signals = detectUserTaggedPhrases([message], tagged);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.detail).toContain("only he knows about this place");
  });

  it("does not flag a message without any tagged phrase", () => {
    const message = msg({ text: "just checking in" });
    expect(detectUserTaggedPhrases([message], [{ phrase: "lake house", note: "x" }])).toHaveLength(0);
  });
});

describe("detectNewCorrelatedIdentifiers", () => {
  it("flags a brand-new sender's first message shortly after a known abuser's last message", () => {
    const known = msg({ sender: "known-abuser@example.com", sentAt: new Date("2026-01-01T00:00:00Z") });
    const newSender = msg({ sender: "burner@example.com", sentAt: new Date("2026-01-02T00:00:00Z") });
    const signals = detectNewCorrelatedIdentifiers([known, newSender], ["known-abuser@example.com"]);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.message.sender).toBe("burner@example.com");
  });

  it("does not flag a new sender outside the correlation window", () => {
    const known = msg({ sender: "known-abuser@example.com", sentAt: new Date("2026-01-01T00:00:00Z") });
    const newSender = msg({ sender: "burner@example.com", sentAt: new Date("2026-02-01T00:00:00Z") });
    expect(detectNewCorrelatedIdentifiers([known, newSender], ["known-abuser@example.com"], 72)).toHaveLength(0);
  });

  it("does not flag anything when there are no known abusive senders", () => {
    const newSender = msg({ sender: "someone@example.com" });
    expect(detectNewCorrelatedIdentifiers([newSender], [])).toHaveLength(0);
  });

  it("does not re-flag messages from a sender who is already known abusive", () => {
    const known1 = msg({ sender: "known-abuser@example.com", sentAt: new Date("2026-01-01T00:00:00Z") });
    const known2 = msg({ sender: "known-abuser@example.com", sentAt: new Date("2026-01-01T01:00:00Z") });
    expect(detectNewCorrelatedIdentifiers([known1, known2], ["known-abuser@example.com"])).toHaveLength(0);
  });
});

describe("detectEscalatingFrequency", () => {
  it("flags a sender whose recent rate greatly exceeds their baseline", () => {
    const messages: Message[] = [];
    // Baseline: 10 messages spread over the preceding 30 days (low rate).
    for (let i = 0; i < 10; i++) {
      messages.push(msg({ sentAt: new Date(Date.UTC(2026, 0, 1 + i * 3)) }));
    }
    // Recent: 20 messages in the last day (high rate).
    const recentBase = Date.UTC(2026, 1, 5);
    for (let i = 0; i < 20; i++) {
      messages.push(msg({ sentAt: new Date(recentBase + i * 60 * 60 * 1000) }));
    }

    const signals = detectEscalatingFrequency(messages);
    expect(signals.length).toBeGreaterThan(0);
  });

  it("does not flag a sender with too few baseline messages to judge", () => {
    const messages = [msg({ sentAt: new Date("2026-01-01T00:00:00Z") }), msg({ sentAt: new Date("2026-01-01T01:00:00Z") })];
    expect(detectEscalatingFrequency(messages)).toHaveLength(0);
  });

  it("does not flag a steady, non-escalating sender", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 40; i++) {
      messages.push(msg({ sentAt: new Date(Date.UTC(2026, 0, 1 + i)) }));
    }
    expect(detectEscalatingFrequency(messages)).toHaveLength(0);
  });
});

describe("detectChannelSwitch", () => {
  it("flags a message when the sender's previous message came from a different source", () => {
    const first = msg({ source: "imessage", sentAt: new Date("2026-01-01T00:00:00Z") });
    const second = msg({ source: "imap", sentAt: new Date("2026-01-02T00:00:00Z") });
    const signals = detectChannelSwitch([first, second]);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.message.source).toBe("imap");
  });

  it("does not flag consecutive messages on the same channel", () => {
    const first = msg({ source: "imessage", sentAt: new Date("2026-01-01T00:00:00Z") });
    const second = msg({ source: "imessage", sentAt: new Date("2026-01-02T00:00:00Z") });
    expect(detectChannelSwitch([first, second])).toHaveLength(0);
  });

  it("does not flag a sender's very first message (nothing to switch from)", () => {
    expect(detectChannelSwitch([msg()])).toHaveLength(0);
  });
});

describe("StructuralSignalDetector", () => {
  it("combines every detector's output", () => {
    const boundaryMessage = msg({ sentAt: new Date("2026-01-02T00:00:00Z") });
    const detector = new StructuralSignalDetector();
    const signals = detector.detect([boundaryMessage], {
      boundaries: [{ setAt: new Date("2026-01-01T00:00:00Z"), description: "stop" }],
      taggedPhrases: [],
      knownAbusiveSenders: [],
    });
    expect(signals.some((s) => s.kind === "contact-after-marked-boundary")).toBe(true);
  });

  it("works with no context at all", () => {
    const detector = new StructuralSignalDetector();
    expect(() => detector.detect([msg()])).not.toThrow();
  });
});
