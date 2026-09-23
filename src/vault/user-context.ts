import type Database from "better-sqlite3";
import type { UserBoundary, UserTaggedPhrase } from "../score/signals";

/**
 * User-authored input to score/signals.ts's structural detectors: marked
 * boundaries and tagged phrases. Lives in the vault, not a plain settings
 * file — a boundary description or a tagged phrase can itself be sensitive
 * (naming a threat, a nickname only an abuser would use), same reasoning
 * as source-config.ts. Mutable like triage-state.ts and source-config.ts:
 * this is configuration a user edits over time, not evidence.
 */
export interface StoredBoundary extends UserBoundary {
  id: string;
}

export interface StoredTaggedPhrase extends UserTaggedPhrase {
  id: string;
}

interface BoundaryRow {
  id: string;
  set_at: string;
  description: string;
  applies_to_sender: string | null;
}

interface TaggedPhraseRow {
  id: string;
  phrase: string;
  note: string;
}

export class UserContextStore {
  constructor(private readonly db: Database.Database) {
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_boundaries (
        id TEXT PRIMARY KEY,
        set_at TEXT NOT NULL,
        description TEXT NOT NULL,
        applies_to_sender TEXT
      );
      CREATE TABLE IF NOT EXISTS user_tagged_phrases (
        id TEXT PRIMARY KEY,
        phrase TEXT NOT NULL,
        note TEXT NOT NULL
      );
    `);
  }

  listBoundaries(): StoredBoundary[] {
    const rows = this.db.prepare(`SELECT * FROM user_boundaries ORDER BY set_at DESC`).all() as BoundaryRow[];
    return rows.map((row) => ({
      id: row.id,
      setAt: new Date(row.set_at),
      description: row.description,
      ...(row.applies_to_sender ? { appliesToSender: row.applies_to_sender } : {}),
    }));
  }

  addBoundary(boundary: UserBoundary): StoredBoundary {
    const id = randomId();
    this.db
      .prepare(`INSERT INTO user_boundaries (id, set_at, description, applies_to_sender) VALUES (?, ?, ?, ?)`)
      .run(id, boundary.setAt.toISOString(), boundary.description, boundary.appliesToSender ?? null);
    return { id, ...boundary };
  }

  removeBoundary(id: string): void {
    this.db.prepare(`DELETE FROM user_boundaries WHERE id = ?`).run(id);
  }

  listTaggedPhrases(): StoredTaggedPhrase[] {
    const rows = this.db.prepare(`SELECT * FROM user_tagged_phrases ORDER BY rowid DESC`).all() as TaggedPhraseRow[];
    return rows.map((row) => ({ id: row.id, phrase: row.phrase, note: row.note }));
  }

  addTaggedPhrase(tagged: UserTaggedPhrase): StoredTaggedPhrase {
    const id = randomId();
    this.db.prepare(`INSERT INTO user_tagged_phrases (id, phrase, note) VALUES (?, ?, ?)`).run(id, tagged.phrase, tagged.note);
    return { id, ...tagged };
  }

  removeTaggedPhrase(id: string): void {
    this.db.prepare(`DELETE FROM user_tagged_phrases WHERE id = ?`).run(id);
  }
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
