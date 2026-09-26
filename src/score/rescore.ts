import type { Classifier } from "./classifier";
import type { RescorableStore } from "../vault/store";

export interface RescoreResult {
  scored: number;
  /** Of `scored`, how many crossed the abuse threshold. */
  crossed: number;
  /** Messages the model failed on. They're marked scored (0, label "unscorable") so a run can't loop on them, and counted here so the UI can say so. */
  failed: number;
}

const BATCH_SIZE = 200;

/**
 * Scores every message from other people that the current model hasn't
 * scored yet: new imports, a vault from before the model shipped, or all
 * of them after a model change. Scores are derived metadata; the message
 * and its evidence hash don't change.
 *
 * `shouldContinue` is checked between batches, so a vault that locks
 * mid-run stops cleanly instead of writing to a closed database.
 */
export async function rescoreUnscored(
  store: RescorableStore,
  classifier: Classifier,
  version: string,
  shouldContinue: () => boolean = () => true,
): Promise<RescoreResult> {
  const result: RescoreResult = { scored: 0, crossed: 0, failed: 0 };
  while (shouldContinue()) {
    const batch = await store.listUnscored(version, BATCH_SIZE);
    if (batch.length === 0) break;
    for (const message of batch) {
      if (!shouldContinue()) return result;
      try {
        const classification = await classifier.classify({ text: message.text });
        store.setScore(message.messageId, message.rawRecordHash, classification, version);
        result.scored++;
        if (classification.crossesAbuseThreshold) result.crossed++;
      } catch (err) {
        console.error(`toxicity model failed on message ${message.messageId}:`, err);
        store.setScore(message.messageId, message.rawRecordHash, { crossesAbuseThreshold: false, toxicityScore: 0, label: "unscorable" }, version);
        result.failed++;
      }
    }
  }
  return result;
}
