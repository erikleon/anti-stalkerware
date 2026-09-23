import type { ThreadSummary, VaultStore } from "../vault/store";
import type { TriageStateStore } from "../vault/triage-state";

/**
 * Merges the append-only thread summary (vault/store.ts) with its
 * separately-stored, mutable view-state (vault/triage-state.ts) into what
 * the triage screen actually renders: one row per thread, bucketed.
 *
 * Band is driven by toxicity score alone for now. score/signals.ts's
 * structural detectors (contact after a marked boundary, location
 * mentions, etc.) aren't folded in here yet — they need a DetectionContext
 * built from user-authored boundaries and tagged phrases, and there's no
 * settings UI to author those yet (see TODOS.md). Once that exists, a
 * thread with a fired structural signal and no overt toxicity should also
 * be able to land in "medium", not just a high toxicity score.
 */
export type Bucket = "needs-review" | "reviewed" | "all";
export type ToxicityBand = "high" | "medium" | "none";

const MEDIUM_BAND_FLOOR = 0.4;

export interface TriageRow extends ThreadSummary {
  reviewed: boolean;
  hidden: boolean;
  band: ToxicityBand;
}

export function bandOf(row: Pick<ThreadSummary, "maxToxicityScore" | "crossesAbuseThreshold">): ToxicityBand {
  if (row.crossesAbuseThreshold) return "high";
  if (row.maxToxicityScore >= MEDIUM_BAND_FLOOR) return "medium";
  return "none";
}

/** True if this row belongs in the given bucket. "all" always matches, including hidden rows — hiding removes a thread from Needs review, never from view entirely. */
export function matchesBucket(row: Pick<TriageRow, "reviewed" | "hidden">, bucket: Bucket): boolean {
  switch (bucket) {
    case "needs-review":
      return !row.reviewed && !row.hidden;
    case "reviewed":
      return row.reviewed;
    case "all":
      return true;
  }
}

/** All threads with view-state merged in and a band assigned, most recent activity first — the source list every bucket filters from. */
export async function listTriageRows(vault: VaultStore, triageState: TriageStateStore): Promise<TriageRow[]> {
  const threads = await vault.listThreads();
  const states = triageState.getAll();
  return threads.map((thread) => {
    const state = states.get(thread.latestMessageId) ?? { reviewed: false, hidden: false };
    return { ...thread, ...state, band: bandOf(thread) };
  });
}

export function countByBucket(rows: TriageRow[]): Record<Bucket, number> {
  return {
    "needs-review": rows.filter((r) => matchesBucket(r, "needs-review")).length,
    reviewed: rows.filter((r) => matchesBucket(r, "reviewed")).length,
    all: rows.length,
  };
}
