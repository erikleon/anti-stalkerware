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
  private lastActivityAt = Date.now();

  constructor(private readonly vaultDir: string) {}

  /** Called on every IPC request that reaches an unlocked vault (see handlers.ts's bind()) — any real use of the app resets the inactivity clock. */
  touch(): void {
    this.lastActivityAt = Date.now();
  }

  /** True once `timeoutMs` has passed with no touch() call. A locked/never-unlocked session is never "idle" — there's nothing to time out. */
  isIdle(timeoutMs: number): boolean {
    return this.isUnlocked() && Date.now() - this.lastActivityAt >= timeoutMs;
  }

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
      this.touch();
      return true;
    } catch (err) {
      // Never sent to the renderer (that's the whole point — see the doc
      // comment above), but a main-process-only log line is not the same
      // exposure: nothing an attacker watching the UI could see reaches
      // them this way, and without it a real bug (a broken native
      // dependency, a permissions error) looks identical to a wrong
      // passphrase and is unfindable.
      console.error("vault unlock failed:", err);
      return false;
    }
  }

  lock(): void {
    this.vault?.close();
    this.vault = undefined;
  }
}
