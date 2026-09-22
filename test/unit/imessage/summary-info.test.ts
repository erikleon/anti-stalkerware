import { describe, expect, it } from "vitest";
import bplist from "bplist-creator";
import { parseSummaryInfo } from "../../../src/ingest/imessage/summary-info";

describe("parseSummaryInfo", () => {
  it("returns no edits for a message that was never edited", () => {
    const blob = bplist({ someOtherField: 1 });
    const result = parseSummaryInfo(blob);
    expect(result).toEqual({ ok: true, edits: [] });
  });

  it("extracts edit revisions from a plain (non-archived) ec array", () => {
    const editedAt = new Date("2026-01-15T10:00:00Z");
    const blob = bplist({
      ec: [{ t: "original wording", d: editedAt.getTime() }],
    });

    const result = parseSummaryInfo(blob);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.edits).toHaveLength(1);
      expect(result.edits[0]?.text).toBe("original wording");
      expect(result.edits[0]?.editedAt.getTime()).toBe(editedAt.getTime());
    }
  });

  it("extracts multiple revisions in order", () => {
    const blob = bplist({
      ec: [
        { text: "first draft", date: 1000 },
        { text: "second draft", date: 2000 },
      ],
    });

    const result = parseSummaryInfo(blob);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.edits.map((e) => e.text)).toEqual(["first draft", "second draft"]);
    }
  });

  it("fails closed (ok: false) when ec entries don't match any known revision shape", () => {
    const blob = bplist({ ec: [{ somethingUnexpected: true }] });
    const result = parseSummaryInfo(blob);
    expect(result.ok).toBe(false);
  });

  it("fails closed when the blob isn't a valid bplist at all", () => {
    const result = parseSummaryInfo(Buffer.from("not a plist"));
    expect(result.ok).toBe(false);
  });
});
