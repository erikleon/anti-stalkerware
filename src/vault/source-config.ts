import type Database from "better-sqlite3";
import type { SourceKind } from "../types/message";

/**
 * Onboarding configuration for each ingest source: connection details and
 * which senders the user chose to include. Lives inside the vault, not the
 * plain outside-vault SettingsStore — this reveals exactly who's being
 * monitored (selectedIdentifiers), which is no less sensitive than the
 * sender/thread data the messages table already stores in plaintext (see
 * crypto.ts's doc comment on what row-level encryption does and doesn't
 * cover), so it gets the vault's protection, not a plaintext local file.
 *
 * A secret (the IMAP app password) never lives here — that goes through
 * CredentialStore, keyed by the account, which already handles encryption
 * for exactly this. This table only ever holds non-secret configuration.
 *
 * Mutable, like triage-state.ts, for the same reason: this is
 * configuration a user can reconnect or disconnect, not evidence.
 */
export type SourceConfig =
  | { source: "imessage"; dbPath: string; selectedIdentifiers: string[] }
  | { source: "android-sms"; exportFilePath: string; selectedIdentifiers: string[] }
  | {
      source: "imap";
      host: string;
      port: number;
      secure: boolean;
      user: string;
      mailbox: string;
      selectedIdentifiers: string[];
    };

interface SourceConfigRow {
  source: string;
  config_json: string;
}

export class SourceConfigStore {
  constructor(private readonly db: Database.Database) {
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source_config (
        source TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(source: SourceKind): SourceConfig | undefined {
    const row = this.db.prepare(`SELECT * FROM source_config WHERE source = ?`).get(source) as
      | SourceConfigRow
      | undefined;
    return row ? (JSON.parse(row.config_json) as SourceConfig) : undefined;
  }

  getAll(): SourceConfig[] {
    const rows = this.db.prepare(`SELECT * FROM source_config`).all() as SourceConfigRow[];
    return rows.map((row) => JSON.parse(row.config_json) as SourceConfig);
  }

  save(config: SourceConfig): void {
    this.db
      .prepare(
        `INSERT INTO source_config (source, config_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
      )
      .run(config.source, JSON.stringify(config), new Date().toISOString());
  }

  remove(source: SourceKind): void {
    this.db.prepare(`DELETE FROM source_config WHERE source = ?`).run(source);
  }
}
