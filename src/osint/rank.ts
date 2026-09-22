import type { Candidate } from "./graph";

/**
 * Turns candidates into a ranked list. Never collapses to a single name or
 * a bare verdict — every result shows the signals behind it and what would
 * confirm or rule it out, and every export of this output is labeled an
 * investigative lead, not proof. Correlating public data is guesswork built
 * on coincidences like a reused username; presenting that as a confident
 * answer risks a wrong accusation against an innocent person.
 */
export interface RankedCandidate {
  candidateId: string;
  score: number;
  supportingSignalCount: number;
}

export function rankCandidates(candidates: Candidate[]): RankedCandidate[] {
  return candidates
    .map((candidate) => ({
      candidateId: candidate.id,
      score: candidate.signals.reduce((sum, signal) => sum + signal.confidence, 0) / candidate.signals.length,
      supportingSignalCount: candidate.signals.length,
    }))
    .sort((a, b) => b.score - a.score);
}
