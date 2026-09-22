import type { Message } from "../types/message";

/**
 * Local, on-device toxicity classification (ONNX runtime, no network call).
 * This catches overtly toxic language: insults, slurs, explicit threats.
 *
 * It will not catch coercive control on its own. A message like "I drove
 * past your work today" carries no toxicity signal but can be terrifying in
 * context. That's what signals.ts and the user's own tagged boundaries are
 * for — this classifier is a first-pass filter, not the whole detector.
 */
export interface ClassificationResult {
  toxicityScore: number;
  crossesAbuseThreshold: boolean;
}

export interface Classifier {
  classify(message: Message): Promise<ClassificationResult>;
}

export const ABUSE_THRESHOLD = 0.7;
