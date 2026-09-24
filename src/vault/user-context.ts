import type Database from "better-sqlite3";
import type { UserBoundary, UserTaggedPhrase } from "../score/signals";
import { startOfLocalDay } from "../time/local-time";

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
  set_on: string | null;
  time_zone: string | null;
  description: string;
  applies_to_sender: string | null;
}

interface TaggedPhraseRow {
  id: string;
  phrase: string;
  note: string;
}

export class UserContextStore {
  /**
   * `timeZone` is this machine's zone. When given, boundaries saved by the
   * old date form are repaired once (see repairUtcMidnightBoundaries).
   */
  constructor(
    private readonly db: Database.Database,
    timeZone?: string,
  ) {
    this.initSchema();
    if (timeZone) this.repairUtcMidnightBoundaries(timeZone);
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
    const columns = (this.db.prepare(`PRAGMA table_info(user_boundaries)`).all() as Array<{ name: string }>).map((c) => c.name);
    if (!columns.includes("set_on")) this.db.exec(`ALTER TABLE user_boundaries ADD COLUMN set_on TEXT`);
    if (!columns.includes("time_zone")) this.db.exec(`ALTER TABLE user_boundaries ADD COLUMN time_zone TEXT`);
  }

  /**
   * Earlier versions read the boundary form's "YYYY-MM-DD" with
   * `new Date(value)`, which is UTC midnight. West of UTC that is the
   * evening before the chosen date, so messages from that evening were
   * flagged as sent after the boundary. Every row that form wrote is
   * exactly UTC midnight with no set_on; each is re-read as the local
   * start of the date the user picked. A row with a set_on is never
   * touched, so this runs only once per row.
   */
  private repairUtcMidnightBoundaries(timeZone: string): void {
    const rows = this.db
      .prepare(`SELECT id, set_at FROM user_boundaries WHERE set_on IS NULL AND set_at LIKE '%T00:00:00.000Z'`)
      .all() as Array<{ id: string; set_at: string }>;
    const update = this.db.prepare(`UPDATE user_boundaries SET set_at = ?, set_on = ?, time_zone = ? WHERE id = ?`);
    this.db.transaction(() => {
      for (const row of rows) {
        const setOn = row.set_at.slice(0, 10);
        update.run(startOfLocalDay(setOn, timeZone).toISOString(), setOn, timeZone, row.id);
      }
    })();
  }

  listBoundaries(): StoredBoundary[] {
    const rows = this.db.prepare(`SELECT * FROM user_boundaries ORDER BY set_at DESC`).all() as BoundaryRow[];
    return rows.map((row) => ({
      id: row.id,
      setAt: new Date(row.set_at),
      ...(row.set_on ? { setOn: row.set_on } : {}),
      ...(row.time_zone ? { timeZone: row.time_zone } : {}),
      description: row.description,
      ...(row.applies_to_sender ? { appliesToSender: row.applies_to_sender } : {}),
    }));
  }

  addBoundary(boundary: UserBoundary): StoredBoundary {
    const id = randomId();
    this.db
      .prepare(`INSERT INTO user_boundaries (id, set_at, set_on, time_zone, description, applies_to_sender) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        boundary.setAt.toISOString(),
        boundary.setOn ?? null,
        boundary.timeZone ?? null,
        boundary.description,
        boundary.appliesToSender ?? null,
      );
    return { id, ...boundary };
  }

  /** Adds a boundary from a date the user picked, starting at the beginning of that day in `timeZone`. */
  addBoundaryOnDate(description: string, setOn: string, timeZone: string, appliesToSender?: string): StoredBoundary {
    return this.addBoundary({
      description,
      setAt: startOfLocalDay(setOn, timeZone),
      setOn,
      timeZone,
      ...(appliesToSender ? { appliesToSender } : {}),
    });
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
