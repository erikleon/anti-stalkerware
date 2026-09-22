/**
 * Evidence for a candidate identity, kept as typed signals rather than a
 * general graph structure. Ranking candidates from a flat table of typed,
 * scored signals covers what this needs (surface what supports each
 * candidate) without the complexity of a graph engine; promote to a real
 * graph only if a future feature needs multi-hop traversal between
 * candidates.
 */
export type OsintSignalKind =
  | "username-reuse"
  | "email-reuse"
  | "phone-reuse"
  | "profile-photo-match"
  | "writing-style-match";

export interface OsintSignal {
  kind: OsintSignalKind;
  candidateId: string;
  /** Where this signal came from, so a person or lawyer can independently check it. */
  source: string;
  confidence: number;
}

export interface Candidate {
  id: string;
  signals: OsintSignal[];
}
