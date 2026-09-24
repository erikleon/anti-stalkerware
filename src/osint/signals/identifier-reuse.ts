import { normalizeIdentifier } from "../unlock";
import type { Message } from "../../types/message";
import type { OsintSignal, OsintSignalKind } from "../graph";

export type IdentifierKind = "username" | "email" | "phone";

const SIGNAL_KIND: Record<IdentifierKind, OsintSignalKind> = {
  username: "username-reuse",
  email: "email-reuse",
  phone: "phone-reuse",
};

/**
 * Checks one candidate-supplied identifier against what the sender
 * themselves was identified by or actually wrote — never against any
 * external source. This can only confirm or weaken a hypothesis a human
 * already formed; given a bare identifier with no vault-held sender to
 * check it against, it has nothing to search (verify-mode, not
 * search-mode — see DESIGN.md's OSINT collector decision).
 *
 * A match against the sender's own identifier (0.9) is stronger evidence
 * than a match found inside message text (0.7): the first means the
 * candidate's known identifier and the sender's are the same or one
 * contains the other; the second means the sender merely mentioned that
 * identifier in something they wrote, which is real but weaker —
 * someone can type any string into a message.
 */
export function checkIdentifierReuse(
  kind: IdentifierKind,
  candidateValue: string,
  senderIdentifier: string,
  senderMessages: readonly Message[],
): Omit<OsintSignal, "candidateId"> | undefined {
  const needle = normalizeIdentifier(candidateValue);
  if (needle.length === 0) return undefined;

  if (normalizeIdentifier(senderIdentifier).includes(needle)) {
    return {
      kind: SIGNAL_KIND[kind],
      source: `matches the sender's own identifier (${senderIdentifier})`,
      confidence: 0.9,
    };
  }

  const fromSender = senderMessages.filter((m) => !m.fromSelf);
  for (const message of fromSender) {
    if (normalizeIdentifier(message.text).includes(needle)) {
      return {
        kind: SIGNAL_KIND[kind],
        source: `appears in a message the sender wrote, ${message.sentAt.toISOString().slice(0, 10)}`,
        confidence: 0.7,
      };
    }
  }

  return undefined;
}
