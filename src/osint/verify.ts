import type { Message } from "../types/message";
import type { CandidateInput } from "./candidate-input";
import type { Candidate, OsintSignal } from "./graph";
import { checkIdentifierReuse } from "./signals/identifier-reuse";
import { checkWritingStyle } from "./signals/writing-style";

/**
 * Builds a Candidate from exactly one user-supplied hypothesis, checking
 * only the fields the human actually filled in against what the sender
 * themselves was identified by or wrote — never inventing a lead from a
 * bare identifier, and never fetching or searching anything on the
 * candidate's behalf. This is the whole of verify-mode (see DESIGN.md's
 * OSINT collector decision): confirm or weaken a hypothesis someone
 * already formed, not discover who someone is.
 */
export function buildCandidate(input: CandidateInput, senderIdentifier: string, senderMessages: readonly Message[]): Candidate {
  const candidateId = input.label.trim().length > 0 ? input.label.trim() : "unnamed candidate";
  const partial: Array<Omit<OsintSignal, "candidateId">> = [];

  if (input.username) {
    const signal = checkIdentifierReuse("username", input.username, senderIdentifier, senderMessages);
    if (signal) partial.push(signal);
  }
  if (input.email) {
    const signal = checkIdentifierReuse("email", input.email, senderIdentifier, senderMessages);
    if (signal) partial.push(signal);
  }
  if (input.phone) {
    const signal = checkIdentifierReuse("phone", input.phone, senderIdentifier, senderMessages);
    if (signal) partial.push(signal);
  }
  if (input.writingSample) {
    const signal = checkWritingStyle(input.writingSample, senderMessages);
    if (signal) partial.push(signal);
  }

  return {
    id: candidateId,
    signals: partial.map((signal) => ({ ...signal, candidateId })),
  };
}
