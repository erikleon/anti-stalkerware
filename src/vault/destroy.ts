/**
 * The one deliberate way to remove vault data, for someone who needs it gone
 * before their device is searched. Kept separate from VaultStore on purpose
 * so ordinary application code has no path to delete anything.
 *
 * This does not reach Time Machine, iCloud or other cloud sync, APFS
 * snapshots, or data an SSD's wear-leveling has already relocated. The
 * confirmation UI must disclose that plainly — a person deciding whether
 * it's safe to leave a laptop behind needs an accurate answer, not a
 * reassuring one.
 */
export interface DestroyResult {
  filesRemoved: string[];
  removedAt: Date;
}

export interface DestroyConfirmation {
  /** The exact phrase the user must type to confirm. Never a plain yes/no. */
  expectedPhrase: string;
  typedPhrase: string;
}

export function confirmationMatches(confirmation: DestroyConfirmation): boolean {
  return confirmation.typedPhrase === confirmation.expectedPhrase;
}
