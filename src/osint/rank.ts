import type { Candidate, OsintSignal } from "./graph";

/**
 * Turns candidates into a ranked list. Never collapses to a single name or
 * a bare verdict — every result carries the actual signals behind it, not
 * just a number, and every export of this output is labeled an
 * investigative lead, not proof. Correlating public data is guesswork built
 * on coincidences like a reused username; presenting that as a confident
 * answer risks a wrong accusation against an innocent person.
 */
export interface RankedCandidate {
  candidateId: string;
  score: number;
  supportingSignalCount: number;
  signals: OsintSignal[];
}

export function rankCandidates(candidates: Candidate[]): RankedCandidate[] {
  return candidates
    .map((candidate) => ({
      candidateId: candidate.id,
      // A candidate with zero matching signals is a real, honest outcome
      // (the user's hypothesis wasn't supported by anything in the
      // vault), not an error — score 0 rather than 0/0, which this app's
      // verify-mode flow makes reachable in the ordinary case, not just
      // a theoretical edge case.
      score: candidate.signals.length === 0 ? 0 : candidate.signals.reduce((sum, signal) => sum + signal.confidence, 0) / candidate.signals.length,
      supportingSignalCount: candidate.signals.length,
      signals: candidate.signals,
    }))
    .sort((a, b) => b.score - a.score);
}
