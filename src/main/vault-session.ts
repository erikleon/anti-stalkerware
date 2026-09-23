import { initializeVault, openVault, vaultExists, type Vault } from "../vault/vault";

/**
 * Holds the single open Vault for the process's lifetime, or none while
 * locked. Nothing outside this module ever sees a raw VaultKey or an open
 * database handle — IPC handlers ask this session for the current vault
 * and get `undefined` if nothing is unlocked, rather than reaching into
 * vault.ts directly.
 */
export class VaultSession {
  private vault: Vault | undefined;

  constructor(private readonly vaultDir: string) {}

  get vaultDirectory(): string {
    return this.vaultDir;
  }

  exists(): boolean {
    return vaultExists(this.vaultDir);
  }

  current(): Vault | undefined {
    return this.vault;
  }

  isUnlocked(): boolean {
    return this.vault !== undefined;
  }

  /** First-run setup, then immediately opens the new vault so the caller doesn't need a second round trip. */
  async initialize(passphrase: string): Promise<boolean> {
    await initializeVault(this.vaultDir, passphrase);
    return this.unlock(passphrase);
  }

  /**
   * Wrong passphrase and a corrupted metadata file both resolve to `false`
   * here, never a distinguishable error — see crypto.ts's UNLOCK_FAILED_MESSAGE
   * doc comment and vault.ts's VaultMetadataError for why collapsing them
   * this early, before anything reaches the renderer, is the point.
   */
  async unlock(passphrase: string): Promise<boolean> {
    try {
      this.vault = await openVault(this.vaultDir, passphrase);
      return true;
    } catch {
      return false;
    }
  }

  lock(): void {
    this.vault?.close();
    this.vault = undefined;
  }
}
