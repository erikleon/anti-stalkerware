import { describe, expect, it } from "vitest";
import { checkWritingStyle } from "../../src/osint/signals/writing-style";
import type { Message } from "../../src/types/message";

function buildMessage(text: string, fromSelf = false): Message {
  return {
    id: `msg-${Math.random()}`,
    rawRecordHash: "hash",
    source: "imap",
    threadId: "thread-a",
    sender: "unknown-sender@example.com",
    fromSelf,
    text,
    sentAt: new Date("2026-01-01T00:00:00Z"),
    provenance: "live",
  };
}

const SENDER_MESSAGES = [
  buildMessage(
    "actually i really don't think you understand what is happening here because like this is really serious and you should know that",
  ),
  buildMessage(
    "just so you know i am actually watching you all the time and you really cannot hide from me because i am always around",
  ),
];

const SIMILAR_STYLE_SAMPLE =
  "actually i really think you should just listen because like i am really trying to explain this and you actually need to understand " +
  "that i am really serious about this whole thing and you should really just pay attention to what i am actually saying right now";

const DISSIMILAR_STYLE_SAMPLE =
  "The quarterly financial report indicates a substantial increase in operational expenditure across multiple departments, necessitating " +
  "a comprehensive review of budgetary allocations moving forward into the subsequent fiscal period pending stakeholder documentation. " +
  "The committee will reconvene next month to evaluate proposed adjustments and determine an appropriate course of corrective action.";

const TOO_SHORT_SAMPLE = "hey it's me, call me back";

describe("checkWritingStyle", () => {
  it("scores a stylistically similar sample higher than a dissimilar one", () => {
    const similar = checkWritingStyle(SIMILAR_STYLE_SAMPLE, SENDER_MESSAGES);
    const dissimilar = checkWritingStyle(DISSIMILAR_STYLE_SAMPLE, SENDER_MESSAGES);
    expect(similar).toBeDefined();
    expect(dissimilar).toBeDefined();
    expect(similar!.confidence).toBeGreaterThan(dissimilar!.confidence);
  });

  it("never returns a confidence at or above what a direct identifier match would (0.7)", () => {
    const similar = checkWritingStyle(SIMILAR_STYLE_SAMPLE, SENDER_MESSAGES);
    expect(similar!.confidence).toBeLessThan(0.7);
  });

  it("returns undefined rather than a false-confident score when the pasted sample is too short", () => {
    const signal = checkWritingStyle(TOO_SHORT_SAMPLE, SENDER_MESSAGES);
    expect(signal).toBeUndefined();
  });

  it("returns undefined when the sender's own messages don't add up to enough text either", () => {
    const signal = checkWritingStyle(SIMILAR_STYLE_SAMPLE, [buildMessage("ok")]);
    expect(signal).toBeUndefined();
  });

  it("excludes the user's own replies from the sender's side of the comparison", () => {
    const onlySelfMessages = [buildMessage("this text is long enough on its own but it was written by me, not the sender, so it shouldn't count as the sender's writing style at all here", true)];
    const signal = checkWritingStyle(SIMILAR_STYLE_SAMPLE, onlySelfMessages);
    expect(signal).toBeUndefined();
  });
});
