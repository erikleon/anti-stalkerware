import type { Message } from "../../types/message";
import type { OsintSignal } from "../graph";

// A short, fixed list of high-frequency English function words. These are
// the standard stylometry substrate — content words vary with topic,
// function words vary with the writer's own habits regardless of what
// they're writing about, which is what makes them useful for comparing
// two texts about completely different things.
const FUNCTION_WORDS = [
  "the", "a", "an", "and", "but", "or", "so", "because", "however",
  "just", "really", "actually", "like", "very", "that", "this",
  "to", "of", "in", "on", "for", "with", "at", "by", "from",
  "is", "are", "was", "were", "be", "been", "i", "you", "it",
] as const;

// Below this many words, per-word frequencies swing too wildly for the
// comparison to mean anything — a coin flip dressed up as a percentage.
// Better to say plainly that there isn't enough text than to hand back a
// confident-looking number built on three sentences.
const MIN_WORD_COUNT = 40;

// Capped well below what an identifier match can reach (0.7-0.9, see
// identifier-reuse.ts): reused writing habits are circumstantial in a way
// a literally-reused email address isn't, and the ranked list should read
// that difference at a glance, not just in the prose next to it.
const MAX_CONFIDENCE = 0.6;

interface StyleFeatures {
  wordCount: number;
  avgWordsPerSentence: number;
  avgWordLength: number;
  functionWordFreq: number[];
}

function extractFeatures(text: string): StyleFeatures | undefined {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < MIN_WORD_COUNT) return undefined;

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;

  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const functionWordFreq = FUNCTION_WORDS.map((fw) => (counts.get(fw) ?? 0) / words.length);

  return { wordCount: words.length, avgWordsPerSentence, avgWordLength, functionWordFreq };
}

/** Non-negative feature vectors only, so this is always in [0, 1] — no separate clamp needed. */
function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! ** 2;
    magB += b[i]! ** 2;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function toVector(f: StyleFeatures): number[] {
  // Sentence length and word length are on a different scale than a 0-1
  // frequency, so they're rescaled into roughly the same range first —
  // otherwise they'd either dominate the cosine similarity or be drowned
  // out by it, depending on which way the units happened to fall.
  return [f.avgWordsPerSentence / 30, f.avgWordLength / 8, ...f.functionWordFreq];
}

/**
 * Compares a pasted writing sample against everything the sender actually
 * wrote in this vault (never text the app fetched itself — the user pastes
 * the candidate's sample in directly). A coarse, explainable heuristic —
 * sentence length, word length, and function-word frequency — not
 * forensic-grade stylometry, and it says so in what it returns rather than
 * implying more rigor than four features and a cosine similarity actually
 * have.
 */
export function checkWritingStyle(writingSample: string, senderMessages: readonly Message[]): Omit<OsintSignal, "candidateId"> | undefined {
  const senderText = senderMessages
    .filter((m) => !m.fromSelf)
    .map((m) => m.text)
    .join(" ");

  const senderFeatures = extractFeatures(senderText);
  const candidateFeatures = extractFeatures(writingSample);
  if (!senderFeatures || !candidateFeatures) return undefined;

  const similarity = cosineSimilarity(toVector(senderFeatures), toVector(candidateFeatures));
  const confidence = similarity * MAX_CONFIDENCE;

  return {
    kind: "writing-style-match",
    source: `coarse stylometric comparison — ${senderFeatures.wordCount} words from the sender vs ${candidateFeatures.wordCount} words supplied; not forensic-grade`,
    confidence,
  };
}
