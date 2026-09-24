import type { Message } from "../types/message";
import type { StoredKnownAccount } from "../vault/known-accounts";
import { accountMatchesIdentifier } from "../vault/known-accounts";
import type { Candidate, OsintSignal } from "./graph";
import { checkIdentifierReuse } from "./signals/identifier-reuse";
import { checkWritingStyle } from "./signals/writing-style";

/**
 * Compares one sender against every person in the user's known-accounts
 * list (usually people they blocked), one candidate per person:
 *
 *   known accounts ──group by personLabel──► person
 *     person's identifiers ──► identifier-reuse vs. the sender
 *     person's own vault messages ──► writing-style vs. the sender
 *                                     (their history from before the block)
 *
 * This is still verify-mode (see DESIGN.md's OSINT collector decision):
 * the list of people is one the user wrote or imported from their own
 * block list, and every comparison runs against messages already in the
 * vault. Nothing is looked up, and a bare identifier can't be turned
 * into a person.
 *
 * `messagesBySender` holds every other vault sender's messages, keyed by
 * sender identifier; the sender being checked is left out of each
 * person's writing baseline, so a sender is never compared with itself.
 */
export function compareWithKnownAccounts(
  knownAccounts: readonly StoredKnownAccount[],
  senderIdentifier: string,
  senderMessages: readonly Message[],
  messagesBySender: ReadonlyMap<string, readonly Message[]>,
): Candidate[] {
  const byPerson = new Map<string, StoredKnownAccount[]>();
  for (const account of knownAccounts) {
    const group = byPerson.get(account.personLabel) ?? [];
    group.push(account);
    byPerson.set(account.personLabel, group);
  }

  const candidates: Candidate[] = [];
  for (const [personLabel, accounts] of byPerson) {
    const signals: Array<Omit<OsintSignal, "candidateId">> = [];

    for (const account of accounts) {
      const signal = checkIdentifierReuse(account.kind, account.value, senderIdentifier, senderMessages);
      if (signal) signals.push({ ...signal, source: `${account.value}: ${signal.source}` });
    }

    const baseline: Message[] = [];
    const baselineAccounts: string[] = [];
    for (const [otherSender, messages] of messagesBySender) {
      if (otherSender === senderIdentifier) continue;
      if (accounts.some((account) => accountMatchesIdentifier(account, otherSender))) {
        baseline.push(...messages.filter((m) => !m.fromSelf));
        baselineAccounts.push(otherSender);
      }
    }
    if (baseline.length > 0) {
      const sample = baseline.map((m) => m.text).join(" ");
      const signal = checkWritingStyle(sample, senderMessages, `from ${baselineAccounts.join(", ")} in your vault`);
      if (signal) signals.push(signal);
    }

    candidates.push({ id: personLabel, signals: signals.map((s) => ({ ...s, candidateId: personLabel })) });
  }
  return candidates;
}
