import type Database from "better-sqlite3";
import type { VaultKey } from "./crypto";

/**
 * The user's own written log of incidents no message records: an
 * in-person encounter, a phone call, a missed custody exchange, being
 * followed. Advocates recommend keeping one, and a log written at the
 * time carries more weight than one reconstructed later, so this store
 * works like the message vault:
 *
 *   - Nothing is deleted, and nothing is overwritten. A change is a new
 *     revision; every earlier revision stays, with the time it was written.
 *   - `writtenAt` comes from this device's clock when the entry is saved.
 *     `occurredAt` is what the user says, and is kept separately.
 *   - Entry text and the "involving" field are encrypted like message
 *     text. The occurred/written timestamps are plaintext so entries can
 *     be sorted without decrypting everything, the same trade-off the
 *     messages table makes for sent_at.
 *
 * The body is HTML from the renderer's editor, already sanitized there.
 * Every reader must sanitize it again before rendering it: this store
 * only holds bytes, and the renderer is the only place with a DOM to
 * sanitize with.
 */
export interface IncidentRevision {
  revision: number;
  writtenAt: Date;
  html: string;
  /** Plain-text version of `html`, for export and search. */
  text: string;
}

export interface IncidentInput {
  /** The instant the incident happened. */
  occurredAt: Date;
  /** The same instant as the user entered it, with offset and zone ("2026-11-01T01:30:00.000-05:00[America/New_York]"). */
  occurredLocal: string;
  /** Who was involved, in the user's words. Optional. */
  involving?: string;
  html: string;
  text: string;
}

export interface IncidentEntry {
  id: string;
  occurredAt: Date;
  occurredLocal: string;
  involving?: string;
  /** Oldest first. The last one is the current text. */
  revisions: IncidentRevision[];
}

interface IncidentRow {
  id: string;
  occurred_at: string;
  occurred_local: Buffer;
  involving: Buffer | null;
}

interface RevisionRow {
  incident_id: string;
  revision: number;
  written_at: string;
  html: Buffer;
  text: Buffer;
}

export class IncidentLogStore {
  constructor(
    private readonly db: Database.Database,
    private readonly key: VaultKey,
  ) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        occurred_local BLOB NOT NULL,
        involving BLOB
      );
      CREATE TABLE IF NOT EXISTS incident_revisions (
        incident_id TEXT NOT NULL REFERENCES incidents(id),
        revision INTEGER NOT NULL,
        written_at TEXT NOT NULL,
        html BLOB NOT NULL,
        text BLOB NOT NULL,
        PRIMARY KEY (incident_id, revision)
      );
    `);
  }

  add(input: IncidentInput, writtenAt: Date = new Date()): IncidentEntry {
    const involving = input.involving?.trim();
    if (input.text.trim().length === 0) throw new Error("an incident needs a description");
    const id = randomId();
    this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO incidents (id, occurred_at, occurred_local, involving) VALUES (?, ?, ?, ?)`)
        .run(id, input.occurredAt.toISOString(), this.seal(input.occurredLocal), involving ? this.seal(involving) : null);
      this.insertRevision(id, 1, writtenAt, input.html, input.text);
    })();
    return this.get(id)!;
  }

  /** Adds a new revision of the text. The earlier text stays in the entry's history. */
  revise(id: string, html: string, text: string, writtenAt: Date = new Date()): IncidentEntry {
    if (text.trim().length === 0) throw new Error("an incident needs a description");
    const current = this.get(id);
    if (!current) throw new Error(`no incident with id ${id}`);
    const latest = current.revisions[current.revisions.length - 1]!;
    if (latest.html === html) return current;
    this.insertRevision(id, latest.revision + 1, writtenAt, html, text);
    return this.get(id)!;
  }

  get(id: string): IncidentEntry | undefined {
    const row = this.db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(id) as IncidentRow | undefined;
    return row ? this.toEntry(row) : undefined;
  }

  /** Every entry, most recent incident first. */
  list(): IncidentEntry[] {
    const rows = this.db.prepare(`SELECT * FROM incidents ORDER BY occurred_at DESC, rowid DESC`).all() as IncidentRow[];
    return rows.map((row) => this.toEntry(row));
  }

  private insertRevision(id: string, revision: number, writtenAt: Date, html: string, text: string): void {
    this.db
      .prepare(`INSERT INTO incident_revisions (incident_id, revision, written_at, html, text) VALUES (?, ?, ?, ?, ?)`)
      .run(id, revision, writtenAt.toISOString(), this.seal(html), this.seal(text));
  }

  private toEntry(row: IncidentRow): IncidentEntry {
    const revisions = (
      this.db.prepare(`SELECT * FROM incident_revisions WHERE incident_id = ? ORDER BY revision`).all(row.id) as RevisionRow[]
    ).map((r) => ({ revision: r.revision, writtenAt: new Date(r.written_at), html: this.open(r.html), text: this.open(r.text) }));
    return {
      id: row.id,
      occurredAt: new Date(row.occurred_at),
      occurredLocal: this.open(row.occurred_local),
      ...(row.involving ? { involving: this.open(row.involving) } : {}),
      revisions,
    };
  }

  private seal(value: string): Buffer {
    return this.key.encrypt(Buffer.from(value, "utf8"));
  }

  private open(value: Buffer): string {
    return this.key.decrypt(value).toString("utf8");
  }
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
