import { describe, expect, it } from "vitest";
import { rankCandidates } from "../../src/osint/rank";
import type { Candidate } from "../../src/osint/graph";

describe("rankCandidates", () => {
  it("orders candidates by average signal confidence, strongest first", () => {
    const candidates: Candidate[] = [
      {
        id: "weak-candidate",
        signals: [{ kind: "username-reuse", candidateId: "weak-candidate", source: "site-a", confidence: 0.3 }],
      },
      {
        id: "strong-candidate",
        signals: [
          { kind: "username-reuse", candidateId: "strong-candidate", source: "site-a", confidence: 0.9 },
          { kind: "email-reuse", candidateId: "strong-candidate", source: "site-b", confidence: 0.8 },
        ],
      },
    ];

    const ranked = rankCandidates(candidates);

    expect(ranked[0]?.candidateId).toBe("strong-candidate");
    expect(ranked[1]?.candidateId).toBe("weak-candidate");
  });

  it("exposes the supporting signal count so a result never presents as a bare verdict", () => {
    const candidates: Candidate[] = [
      {
        id: "candidate-1",
        signals: [
          { kind: "username-reuse", candidateId: "candidate-1", source: "site-a", confidence: 0.5 },
          { kind: "phone-reuse", candidateId: "candidate-1", source: "site-c", confidence: 0.6 },
        ],
      },
    ];

    const ranked = rankCandidates(candidates);
    expect(ranked[0]?.supportingSignalCount).toBe(2);
  });

  it("scores a candidate with zero matching signals as 0, not NaN — a real, honest outcome for verify-mode, not just an edge case", () => {
    const candidates: Candidate[] = [{ id: "unsupported-candidate", signals: [] }];
    const ranked = rankCandidates(candidates);
    expect(ranked[0]?.score).toBe(0);
    expect(Number.isNaN(ranked[0]?.score)).toBe(false);
  });

  it("carries the actual signals through, not just a score, so a result never presents as a bare verdict", () => {
    const signal = { kind: "username-reuse" as const, candidateId: "candidate-1", source: "site-a", confidence: 0.5 };
    const candidates: Candidate[] = [{ id: "candidate-1", signals: [signal] }];
    const ranked = rankCandidates(candidates);
    expect(ranked[0]?.signals).toEqual([signal]);
  });
});
