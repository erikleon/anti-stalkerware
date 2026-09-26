import type { ThreadSummary, VaultStore } from "../vault/store";
import type { TriageStateStore } from "../vault/triage-state";
import type { UserContextStore } from "../vault/user-context";
import { StructuralSignalDetector, type Signal } from "../score/signals";

/**
 * Merges the append-only thread summary (vault/store.ts) with its
 * separately-stored, mutable view-state (vault/triage-state.ts) into what
 * the triage screen actually renders: one row per thread, bucketed.
 *
 * Band is driven by toxicity score OR a fired structural signal
 * (score/signals.ts's StructuralSignalDetector — contact after a marked
 * boundary, a tagged phrase, escalating frequency, etc.), whichever is
 * more severe. The detector needs the user's authored boundaries and
 * tagged phrases (vault/user-context.ts) plus which senders already
 * crossed the toxicity threshold — see listTriageRows.
 */
export type Bucket = "needs-review" | "reviewed" | "all";
export type ToxicityBand = "high" | "medium" | "none";

const MEDIUM_BAND_FLOOR = 0.4;

export interface TriageRow extends ThreadSummary {
  reviewed: boolean;
  hidden: boolean;
  band: ToxicityBand;
  /** Human-readable reasons a structural signal fired for this thread (score/signals.ts's Signal.detail) — empty when the band, if any, came from toxicity score alone. */
  signalDetails: string[];
}

export function bandOf(row: Pick<ThreadSummary, "maxToxicityScore" | "crossesAbuseThreshold">, hasStructuralSignal = false): ToxicityBand {
  if (row.crossesAbuseThreshold) return "high";
  if (row.maxToxicityScore >= MEDIUM_BAND_FLOOR) return "medium";
  if (hasStructuralSignal) return "medium";
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

/**
 * All threads with view-state merged in and a band assigned, most recent
 * activity first — the source list every bucket filters from.
 *
 * The structural detector runs once across every message in the vault,
 * not per-thread: detectNewCorrelatedIdentifiers and detectEscalatingFrequency
 * specifically look for patterns *across* senders/threads (a new number
 * texting right after a known-abusive one goes quiet), which a per-thread
 * scan could never see. This is O(all vault messages) on every call —
 * fine at the scale this app is built for; revisit if a large vault makes
 * triage list renders noticeably slow.
 */
export async function listTriageRows(vault: VaultStore, triageState: TriageStateStore, userContext: UserContextStore): Promise<TriageRow[]> {
  const threads = await vault.listThreads();
  const states = triageState.getAll();

  const boundaries = userContext.listBoundaries();
  const taggedPhrases = userContext.listTaggedPhrases();
  const allMessages = (await Promise.all(threads.map((t) => vault.list(t.threadId)))).flat();
  const knownAbusiveSenders = threads.filter((t) => t.crossesAbuseThreshold).map((t) => t.sender);

  const signals = new StructuralSignalDetector().detect(allMessages, { boundaries, taggedPhrases, knownAbusiveSenders });
  const signalsByThread = new Map<string, Signal[]>();
  for (const signal of signals) {
    const list = signalsByThread.get(signal.message.threadId) ?? [];
    list.push(signal);
    signalsByThread.set(signal.message.threadId, list);
  }

  return threads.map((thread) => {
    const state = states.get(thread.latestMessageId) ?? { reviewed: false, hidden: false };
    const threadSignals = signalsByThread.get(thread.threadId) ?? [];
    return {
      ...thread,
      ...state,
      band: bandOf(thread, threadSignals.length > 0),
      signalDetails: [...modelReason(thread), ...threadSignals.map((s) => s.detail)],
    };
  });
}

const LABEL_TEXT: Record<string, string> = {
  toxic: "hostile language",
  severe_toxic: "severely hostile language",
  threat: "a threat",
  insult: "an insult",
  identity_hate: "identity-based hate",
};

/** Why the toxicity model flagged a thread, in words, when its score reached the Medium band. */
function modelReason(thread: { maxToxicityScore: number; maxToxicityLabel?: string }): string[] {
  if (thread.maxToxicityScore < MEDIUM_BAND_FLOOR || !thread.maxToxicityLabel) return [];
  const what = LABEL_TEXT[thread.maxToxicityLabel] ?? thread.maxToxicityLabel;
  return [`Toxicity model: reads as ${what} (${Math.round(thread.maxToxicityScore * 100)}%)`];
}

export function countByBucket(rows: TriageRow[]): Record<Bucket, number> {
  return {
    "needs-review": rows.filter((r) => matchesBucket(r, "needs-review")).length,
    reviewed: rows.filter((r) => matchesBucket(r, "reviewed")).length,
    all: rows.length,
  };
}
