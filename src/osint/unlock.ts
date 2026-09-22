import type { VaultStore } from "../vault/store";

/**
 * The gate in front of the OSINT module. It accepts no free-text subject —
 * only a sender identifier that already exists in the user's own vault and
 * has crossed the abuse threshold there.
 *
 * Be precise about what this proves, because it's easy to overstate: it is
 * friction against casual misuse, not verification that the subject is
 * actually the harasser. Someone motivated enough can manufacture the
 * precondition (a forged inbound message, a provoked borderline score).
 * That's why OSINT output is barred from evidentiary exports and always
 * labeled an unverified lead, never a confirmed identity — the gate limits
 * who this feature is easy to misuse by, not what happens if it is.
 */
export async function canUnlockOsint(sender: string, vault: VaultStore): Promise<boolean> {
  return vault.isAbusiveSender(normalizeIdentifier(sender));
}

/**
 * Normalizes an identifier before the membership check, closing the
 * simplest bypass: a lookalike identifier (different case, extra
 * whitespace, a unicode homoglyph) that reads as a match to a human but
 * not to a naive string comparison, or vice versa.
 */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase().normalize("NFKC");
}
