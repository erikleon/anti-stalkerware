import type { VaultStore } from "../vault/store";
import { canUnlockOsint } from "./unlock";

export interface SenderEligibility {
  sender: string;
  eligible: boolean;
}

/**
 * Every distinct sender in the vault with whether they clear the OSINT
 * gate (see unlock.ts) — what the OSINT locked screen lists. Deliberately
 * shows ineligible senders too, alongside why, rather than hiding them:
 * the point of D22's honesty requirement is that this friction is visible,
 * not a silent wall.
 */
export async function listEligibility(vault: VaultStore): Promise<SenderEligibility[]> {
  const threads = await vault.listThreads();
  const senders = [...new Set(threads.map((t) => t.sender))];
  return Promise.all(
    senders.map(async (sender) => ({ sender, eligible: await canUnlockOsint(sender, vault) })),
  );
}
