import { normalizeIdentifier } from "../unlock";
import { normalizePhoneNumber } from "../../ingest/android-sms/reader";
import { localDateString, localTimeZone } from "../../time/local-time";
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
  /** The zone message dates are shown in: the day the person saw the message arrive, not the UTC day. */
  timeZone: string = localTimeZone(),
): Omit<OsintSignal, "candidateId"> | undefined {
  if (kind === "phone") return checkPhoneReuse(candidateValue, senderIdentifier, senderMessages, timeZone);

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
        source: `appears in a message the sender wrote, ${localDateString(message.sentAt, timeZone)}`,
        confidence: 0.7,
      };
    }
  }

  return undefined;
}

// Fewer digits than this is not a phone number anyone could reuse on
// purpose — "555" would match half the numbers in a message.
const MIN_PHONE_DIGITS = 7;

// A run of digits with the separators people type between them:
// "+1 (555) 123-4567", "555.123.4567", "5551234567".
const PHONE_LIKE_RUN = /\+?\d[\d\s().-]{5,}\d/g;

/**
 * Phone numbers are compared on digits only (see normalizePhoneNumber),
 * because the same number arrives as "+15551234567" from iMessage, as
 * "(555) 123-4567" from a person typing it, and as "5551234567" from an
 * Android export. A plain string compare would miss all three.
 */
function checkPhoneReuse(
  candidateValue: string,
  senderIdentifier: string,
  senderMessages: readonly Message[],
  timeZone: string,
): Omit<OsintSignal, "candidateId"> | undefined {
  const needle = normalizePhoneNumber(candidateValue);
  if (needle.length < MIN_PHONE_DIGITS) return undefined;

  if (normalizePhoneNumber(senderIdentifier) === needle) {
    return {
      kind: "phone-reuse",
      source: `matches the sender's own identifier (${senderIdentifier})`,
      confidence: 0.9,
    };
  }

  for (const message of senderMessages.filter((m) => !m.fromSelf)) {
    const runs = message.text.match(PHONE_LIKE_RUN) ?? [];
    if (runs.some((run) => normalizePhoneNumber(run) === needle)) {
      return {
        kind: "phone-reuse",
        source: `appears in a message the sender wrote, ${localDateString(message.sentAt, timeZone)}`,
        confidence: 0.7,
      };
    }
  }

  return undefined;
}
