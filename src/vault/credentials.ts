/**
 * IMAP and OAuth credentials live inside the encrypted vault rather than the
 * OS keychain. The OS keychain unlocks with the OS login, which the threat
 * model here assumes is already known to the adversary; the vault has its
 * own separate passphrase. This does mean a single compromise of the vault
 * exposes both credentials and evidence together — accepted deliberately,
 * since it avoids introducing a second secret for the user to manage.
 */
export interface StoredCredential {
  account: string;
  /** OAuth refresh token where the provider supports it; an app-specific password otherwise. Never the account's main password. */
  secret: string;
  kind: "oauth-refresh-token" | "app-password";
}

export interface CredentialStore {
  save(credential: StoredCredential): Promise<void>;
  get(account: string): Promise<StoredCredential | undefined>;
}
