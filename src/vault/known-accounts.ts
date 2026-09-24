import type Database from "better-sqlite3";
import { normalizePhoneNumber } from "../ingest/android-sms/reader";
import { normalizeIdentifier } from "../osint/unlock";

/**
 * Accounts the user already knows belong to someone harassing them —
 * most often numbers and profiles they blocked. These are the baseline
 * OSINT compares a new, unknown sender against: a blocked ex who comes
 * back from a new number still writes the same way, and often still
 * mentions the old number or handle.
 *
 * The user supplies every row, directly or by importing their own block
 * list. Nothing here is discovered or looked up. Lives in the vault for
 * the same reason as user-context.ts: a list of who someone blocked is
 * itself sensitive. Mutable configuration, not evidence.
 */
export type KnownAccountKind = "phone" | "email" | "username";

/** Where a row came from, shown next to it so the user can tell an import from something they typed. */
export type KnownAccountOrigin = "manual" | "macos-blocklist" | "instagram-blocklist";

export interface KnownAccountInput {
  /** Who the user says this account belongs to. Accounts with the same label are compared as one person. */
  personLabel: string;
  kind: KnownAccountKind;
  value: string;
  origin: KnownAccountOrigin;
}

export interface StoredKnownAccount extends KnownAccountInput {
  id: string;
  addedAt: Date;
}

export interface AddManyResult {
  added: number;
  alreadyKnown: number;
}

interface KnownAccountRow {
  id: string;
  person_label: string;
  kind: string;
  value: string;
  origin: string;
  added_at: string;
}

/**
 * The comparison key for an identifier: digits only for a phone number
 * (see normalizePhoneNumber), case/whitespace/homoglyph-folded for
 * anything else, with a leading "@" dropped from a username so "@alex"
 * and "alex" are the same account.
 */
export function accountMatchKey(kind: KnownAccountKind, value: string): string {
  if (kind === "phone") return normalizePhoneNumber(value);
  const normalized = normalizeIdentifier(value);
  return kind === "username" ? normalized.replace(/^@/, "") : normalized;
}

/**
 * A best guess at what kind of identifier a sender is, from its shape
 * alone: an email address has an "@" after its first character, a phone
 * number is mostly digits, anything else is a username or display name.
 */
export function inferAccountKind(identifier: string): KnownAccountKind {
  const trimmed = identifier.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return "email";
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length >= 7 && /^[+\d\s().-]+$/.test(trimmed)) return "phone";
  return "username";
}

/** True if this known account is the same account as a sender's identifier. */
export function accountMatchesIdentifier(account: Pick<KnownAccountInput, "kind" | "value">, identifier: string): boolean {
  if (inferAccountKind(identifier) !== account.kind) return false;
  const key = accountMatchKey(account.kind, account.value);
  return key.length > 0 && key === accountMatchKey(account.kind, identifier);
}

export class KnownAccountStore {
  constructor(private readonly db: Database.Database) {
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS known_accounts (
        id TEXT PRIMARY KEY,
        person_label TEXT NOT NULL,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        match_key TEXT NOT NULL,
        origin TEXT NOT NULL,
        added_at TEXT NOT NULL,
        UNIQUE (kind, match_key)
      );
    `);
  }

  list(): StoredKnownAccount[] {
    const rows = this.db.prepare(`SELECT * FROM known_accounts ORDER BY person_label, added_at`).all() as KnownAccountRow[];
    return rows.map(toStored);
  }

  /**
   * Adds one account, or returns the existing row unchanged if the same
   * account is already known. Re-importing a block list must never
   * overwrite a person label the user already set by hand.
   */
  add(input: KnownAccountInput): StoredKnownAccount {
    const personLabel = input.personLabel.trim();
    const value = input.value.trim();
    if (personLabel.length === 0) throw new Error("a known account needs a person label");
    const matchKey = accountMatchKey(input.kind, value);
    if (matchKey.length === 0) throw new Error(`"${input.value}" is not a usable ${input.kind}`);

    const existing = this.db.prepare(`SELECT * FROM known_accounts WHERE kind = ? AND match_key = ?`).get(input.kind, matchKey) as
      | KnownAccountRow
      | undefined;
    if (existing) return toStored(existing);

    const row: KnownAccountRow = {
      id: randomId(),
      person_label: personLabel,
      kind: input.kind,
      value,
      origin: input.origin,
      added_at: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO known_accounts (id, person_label, kind, value, match_key, origin, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.person_label, row.kind, row.value, matchKey, row.origin, row.added_at);
    return toStored(row);
  }

  /** Imports a batch (a block list) in one transaction, counting what was new versus already known. */
  addMany(inputs: readonly KnownAccountInput[]): AddManyResult {
    const before = this.count();
    this.db.transaction(() => {
      for (const input of inputs) this.add(input);
    })();
    const added = this.count() - before;
    return { added, alreadyKnown: inputs.length - added };
  }

  setPersonLabel(id: string, personLabel: string): void {
    const trimmed = personLabel.trim();
    if (trimmed.length === 0) throw new Error("a known account needs a person label");
    this.db.prepare(`UPDATE known_accounts SET person_label = ? WHERE id = ?`).run(trimmed, id);
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM known_accounts WHERE id = ?`).run(id);
  }

  /** The known account a sender identifier belongs to, if any. */
  findMatch(identifier: string): StoredKnownAccount | undefined {
    const kind = inferAccountKind(identifier);
    const key = accountMatchKey(kind, identifier);
    if (key.length === 0) return undefined;
    const row = this.db.prepare(`SELECT * FROM known_accounts WHERE kind = ? AND match_key = ?`).get(kind, key) as
      | KnownAccountRow
      | undefined;
    return row ? toStored(row) : undefined;
  }

  private count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM known_accounts`).get() as { n: number }).n;
  }
}

function toStored(row: KnownAccountRow): StoredKnownAccount {
  return {
    id: row.id,
    personLabel: row.person_label,
    kind: row.kind as KnownAccountKind,
    value: row.value,
    origin: row.origin as KnownAccountOrigin,
    addedAt: new Date(row.added_at),
  };
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
