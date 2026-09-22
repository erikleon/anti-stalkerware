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
});
