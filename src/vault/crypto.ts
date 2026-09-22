/**
 * Vault encryption. The passphrase here must be independent of the OS
 * login: the threat model is an adversary who already knows the device
 * password, so unlocking the vault has to require a separate secret.
 *
 * KDF parameters, in-memory key handling, inactivity auto-lock, and
 * clipboard/temp-file hygiene are not decided yet — see TODOS.md,
 * "Harden vault key management". Treat this interface as provisional
 * until that work lands.
 */
export interface VaultCrypto {
  unlock(passphrase: string): Promise<VaultKey>;
  lock(): Promise<void>;
}

export interface VaultKey {
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer): Buffer;
}
