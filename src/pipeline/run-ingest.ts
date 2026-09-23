import type { IngestAdapter } from "../ingest/adapter";
import type { VaultStore } from "../vault/store";
import type { Classifier } from "../score/classifier";

export interface IngestRunResult {
  appended: number;
  quarantined: number;
}

/**
 * Runs one ingest adapter to completion against the vault: pulls records
 * since the last checkpoint, classifies each message, and appends
 * everything. Quarantined records are recorded, never dropped silently.
 *
 * `classifier` is optional because no ONNX model ships with this app (see
 * score/classifier.ts's doc comment) — without one, every message is
 * appended unclassified (score 0, doesn't cross the abuse threshold)
 * rather than blocking ingest on a model nobody has configured yet.
 *
 * Checkpoint persistence across runs isn't wired up here — the caller
 * decides what `sinceCheckpoint` to pass. Re-running from an earlier
 * checkpoint just reprocesses already-seen records; append() is
 * INSERT OR IGNORE keyed on (message_id, raw_record_hash), so that's
 * wasted classification work, not a correctness bug or a duplicate row.
 *
 * Structural signal detection (score/signals.ts) isn't run here either:
 * those detectors need a DetectionContext built from user-authored
 * boundaries and tagged phrases, and there's no settings UI to author
 * those yet — see TODOS.md.
 */
export async function runIngest(
  adapter: IngestAdapter,
  vault: VaultStore,
  classifier: Classifier | undefined,
  sinceCheckpoint: string | undefined,
): Promise<IngestRunResult> {
  let appended = 0;
  let quarantined = 0;

  for await (const result of adapter.acquire(sinceCheckpoint)) {
    if (result.kind === "quarantined") {
      await vault.recordQuarantine(result.quarantine);
      quarantined++;
      continue;
    }

    const classification = classifier
      ? await classifier.classify(result.message)
      : { toxicityScore: 0, crossesAbuseThreshold: false };

    await vault.append(result.raw, result.message, classification);
    appended++;
  }

  return { appended, quarantined };
}
