import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The one deliberate way to remove vault data, for someone who needs it gone
 * before their device is searched. Kept separate from VaultStore on purpose
 * so ordinary application code has no path to delete anything.
 *
 * This does not reach Time Machine, iCloud or other cloud sync, APFS
 * snapshots, or data an SSD's wear-leveling has already relocated. The
 * confirmation UI must disclose that plainly — a person deciding whether
 * it's safe to leave a laptop behind needs an accurate answer, not a
 * reassuring one. DESTROY_DISCLOSURE_TEXT below is the canonical wording
 * for that, so whoever builds the confirmation dialog doesn't have to
 * reinvent — or accidentally soften — it.
 */
export const DESTROY_DISCLOSURE_TEXT =
  "This removes the vault files this application controls on this device. " +
  "It cannot remove copies already made by Time Machine, iCloud or other cloud backup, " +
  "APFS snapshots, or data your drive itself has retained internally. " +
  "If you need to be certain nothing recoverable remains, those backup systems " +
  "need to be checked separately.";

export interface DestroyResult {
  filesRemoved: string[];
  removedAt: Date;
}

export interface DestroyConfirmation {
  /** The exact phrase the user must type to confirm. Never a plain yes/no. */
  expectedPhrase: string;
  typedPhrase: string;
}

export const DESTROY_CONFIRMATION_PHRASE = "REMOVE LOCAL APP DATA";

export function confirmationMatches(confirmation: DestroyConfirmation): boolean {
  return confirmation.typedPhrase === confirmation.expectedPhrase;
}

/**
 * Deletes the vault's own files: the database and its WAL/SHM siblings,
 * and the metadata file. Refuses to run without a confirmation that
 * matches exactly — this is the one place in the codebase allowed to
 * delete anything, so it does not get a lenient default.
 */
export async function destroyVault(vaultDir: string, confirmation: DestroyConfirmation): Promise<DestroyResult> {
  if (!confirmationMatches(confirmation)) {
    throw new Error("destroy confirmation phrase did not match — nothing was removed");
  }

  const candidateFiles = [
    "vault.db",
    "vault.db-wal",
    "vault.db-shm",
    "vault.meta.json",
  ].map((name) => join(vaultDir, name));

  const filesRemoved: string[] = [];
  for (const filePath of candidateFiles) {
    if (existsSync(filePath)) {
      await rm(filePath, { force: true });
      filesRemoved.push(filePath);
    }
  }

  return { filesRemoved, removedAt: new Date() };
}
