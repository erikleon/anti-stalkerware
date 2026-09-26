import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Tokenizer as HfTokenizer } from "@huggingface/tokenizers";
import { loadOnnxSession, OnnxToxicityClassifier, type Classifier, type TokenizedInput, type Tokenizer } from "./classifier";

/**
 * The toxicity model docket ships: minuva/MiniLMv2-toxic-jigsaw-onnx, a
 * 23 MB quantized MiniLM distilled from unitary/toxic-bert (Apache-2.0),
 * trained on the Jigsaw toxic comment data. It outputs six independent
 * labels: toxic, severe_toxic, obscene, threat, insult, identity_hate.
 *
 * Files and hashes are pinned in models/toxicity.json. Developers and CI
 * get them with scripts/fetch-model.mjs; the packaged app bundles them
 * and never downloads anything. Every file's hash is checked again here,
 * so a damaged or swapped model fails loudly instead of scoring quietly.
 */

/**
 * Labels that count toward the abuse score. "obscene" is left out: it
 * fires on swearing alone.
 *
 * "toxic" also fires on swearing alone ("lol fuck yes, see you there"
 * scores 0.98), which would flag friends and open the OSINT gate on them.
 * So "toxic" only counts for the part swearing doesn't explain:
 * toxic × (1 − obscene). Hostile messages that swear still score high on
 * "insult" or "threat", which this doesn't touch. See
 * test/unit/score/toxicity-model.test.ts for the examples this was
 * calibrated on.
 */
const SCORED_LABELS = new Set(["toxic", "severe_toxic", "threat", "insult", "identity_hate"]);

export function discountSwearing(labels: readonly string[]): (probabilities: number[]) => number[] {
  const toxic = labels.indexOf("toxic");
  const obscene = labels.indexOf("obscene");
  return (probabilities) =>
    probabilities.map((p, i) => (i === toxic && obscene >= 0 ? p * (1 - (probabilities[obscene] ?? 0)) : p));
}

interface ModelManifest {
  id: string;
  revision: string;
  model: string;
  files: Array<{ name: string; sha256: string }>;
}

export interface LoadedToxicityModel {
  classifier: Classifier;
  /** "<model id>@<revision>", stored with every score so a later model change can rescore. */
  version: string;
}

/** `modelsDir` holds toxicity.json and the toxicity/ folder of files it lists. */
export async function loadToxicityModel(modelsDir: string): Promise<LoadedToxicityModel> {
  const manifest = JSON.parse(await readFile(join(modelsDir, "toxicity.json"), "utf8")) as ModelManifest;
  const fileDir = join(modelsDir, "toxicity");

  for (const file of manifest.files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(fileDir, file.name));
    } catch (err) {
      throw new Error(`toxicity model file ${file.name} is missing (${(err as Error).message}). Run: npm run fetch-model`);
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== file.sha256) {
      throw new Error(`toxicity model file ${file.name} doesn't match models/toxicity.json (sha256 ${actual})`);
    }
  }

  const config = JSON.parse(await readFile(join(fileDir, "config.json"), "utf8")) as { id2label: Record<string, string> };
  const labels = Object.entries(config.id2label)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, label]) => label);
  const scoreIndices = labels.flatMap((label, index) => (SCORED_LABELS.has(label) ? [index] : []));
  if (scoreIndices.length !== SCORED_LABELS.size) {
    throw new Error(`toxicity model labels ${labels.join(", ")} don't include every expected label`);
  }

  const tokenizer = createBertWindowTokenizer(
    JSON.parse(await readFile(join(fileDir, "tokenizer.json"), "utf8")) as Record<string, unknown>,
    JSON.parse(await readFile(join(fileDir, "tokenizer_config.json"), "utf8")) as Record<string, unknown>,
  );
  const session = await loadOnnxSession(join(fileDir, manifest.model));

  return {
    classifier: new OnnxToxicityClassifier(session, {
      tokenizer,
      inputNames: { inputIds: "input_ids", attentionMask: "attention_mask", tokenTypeIds: "token_type_ids" },
      outputName: "logits",
      activation: "sigmoid",
      scoreIndices,
      labels,
      adjust: discountSwearing(labels),
    }),
    version: `${manifest.id}@${manifest.revision}`,
  };
}

/** BERT's input limit, including the [CLS] and [SEP] tokens around each window. */
const MAX_TOKENS = 512;

/**
 * A BERT WordPiece tokenizer (Hugging Face's own implementation, reading
 * the model's tokenizer.json) that never cuts text off:
 *
 *   - The whole text, in 512-token windows (BERT's input limit).
 *   - When the text has more than one sentence, each sentence on its own
 *     too. A threat at the end of a long, calm email scores 0.8 alone but
 *     well under the threshold inside a window of 450 ordinary tokens;
 *     the model reads the whole window, not its worst sentence.
 *
 * The classifier scores every window and keeps the highest.
 */
export function createBertWindowTokenizer(tokenizerJson: Record<string, unknown>, tokenizerConfig: Record<string, unknown>): Tokenizer {
  const hf = new HfTokenizer(tokenizerJson, tokenizerConfig);
  const vocab = (tokenizerJson["model"] as { vocab: Record<string, number> }).vocab;
  const cls = vocab["[CLS]"];
  const sep = vocab["[SEP]"];
  if (cls === undefined || sep === undefined) throw new Error("tokenizer vocabulary has no [CLS] or [SEP] token");

  const windowsOf = (text: string): TokenizedInput[] => {
    const ids = hf.encode(text, { add_special_tokens: false }).ids;
    const size = MAX_TOKENS - 2;
    const windows: TokenizedInput[] = [];
    for (let start = 0; start === 0 || start < ids.length; start += size) {
      const chunk = [cls, ...ids.slice(start, start + size), sep];
      windows.push({ inputIds: chunk.map((id) => BigInt(id)), attentionMask: chunk.map(() => 1n) });
    }
    return windows;
  };

  return {
    encode(text: string): TokenizedInput[] {
      const sentences = splitSentences(text);
      const windows = windowsOf(text);
      if (sentences.length > 1) for (const sentence of sentences) windows.push(...windowsOf(sentence));
      return windows;
    },
  };
}

/** Sentences and lines, for scoring each on its own. Rough on purpose: a wrong split only adds a window, it never drops text. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
