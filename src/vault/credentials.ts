import type Database from "better-sqlite3";
import type { VaultKey } from "./crypto";

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
  remove(account: string): Promise<void>;
}

interface CredentialRow {
  account: string;
  secret: Buffer;
  kind: string;
}

/**
 * Shares the vault's SQLite database and encryption key rather than a
 * separate file — one vault, one passphrase, everything behind it. `save`
 * overwrites the previous credential for an account (a refreshed OAuth
 * token replacing an expired one): unlike message history, a stale
 * credential has no evidentiary value worth keeping, so this table is
 * exempt from the store's append-only rule.
 */
export class SqliteCredentialStore implements CredentialStore {
  constructor(private readonly db: Database.Database, private readonly key: VaultKey) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        account TEXT PRIMARY KEY,
        secret BLOB NOT NULL,
        kind TEXT NOT NULL
      );
    `);
  }

  async save(credential: StoredCredential): Promise<void> {
    this.db
      .prepare(`INSERT INTO credentials (account, secret, kind) VALUES (?, ?, ?)
                ON CONFLICT(account) DO UPDATE SET secret = excluded.secret, kind = excluded.kind`)
      .run(credential.account, this.key.encrypt(Buffer.from(credential.secret, "utf8")), credential.kind);
  }

  async get(account: string): Promise<StoredCredential | undefined> {
    const row = this.db.prepare(`SELECT * FROM credentials WHERE account = ?`).get(account) as
      | CredentialRow
      | undefined;
    if (!row) return undefined;
    return {
      account: row.account,
      secret: this.key.decrypt(row.secret).toString("utf8"),
      kind: row.kind as StoredCredential["kind"],
    };
  }

  async remove(account: string): Promise<void> {
    this.db.prepare(`DELETE FROM credentials WHERE account = ?`).run(account);
  }
}
