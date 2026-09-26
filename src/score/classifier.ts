import { InferenceSession, Tensor } from "onnxruntime-node";
import type { Message } from "../types/message";

/**
 * Local, on-device toxicity classification (ONNX runtime, no network call).
 * This catches overtly toxic language: insults, slurs, explicit threats.
 *
 * It will not catch coercive control on its own. A message like "I drove
 * past your work today" carries no toxicity signal but can be terrifying in
 * context. That's what score/signals.ts and the user's own tagged
 * boundaries are for — this classifier is a first-pass filter, not the
 * whole detector.
 *
 * Tokenization, tensor names, and how to read the output are injected
 * rather than hardcoded, because they're properties of a specific ONNX
 * model. The model docket ships is wired up in toxicity-model.ts; this
 * file only runs whatever it's given.
 */
export interface ClassificationResult {
  toxicityScore: number;
  crossesAbuseThreshold: boolean;
  /** The output label that gave the score (e.g. "threat"), when the model names its labels. */
  label?: string;
}

export interface Classifier {
  classify(message: Message): Promise<ClassificationResult>;
}

export const ABUSE_THRESHOLD = 0.7;

export interface TokenizedInput {
  inputIds: bigint[];
  attentionMask: bigint[];
}

/**
 * Turns text into model input. Model-specific (vocabulary, special
 * tokens, max length). Returns one window per model-length chunk of a
 * long text, so nothing past the model's limit is silently cut off; the
 * classifier scores every window and keeps the highest.
 */
export interface Tokenizer {
  encode(text: string): TokenizedInput[];
}

/** The slice of onnxruntime-node's InferenceSession this classifier needs — narrow on purpose so tests can inject a fake session instead of a real model file. */
export interface OnnxSession {
  run(feeds: Record<string, Tensor>): Promise<Record<string, { data: ArrayLike<number> | ArrayLike<bigint> | readonly string[] }>>;
}

export interface OnnxClassifierConfig {
  tokenizer: Tokenizer;
  /** Tensor names this specific model's graph expects as input. `tokenTypeIds` is for BERT-style models that take one; it's always all zeros for a single text. */
  inputNames: { inputIds: string; attentionMask: string; tokenTypeIds?: string };
  /** Tensor name this specific model's graph produces as output. */
  outputName: string;
  /**
   * How to turn the output into probabilities: "softmax" for a
   * single-label model's logits (the classes compete), "sigmoid" for a
   * multi-label model's logits (each label is its own yes/no), "none" when
   * the output already is probabilities.
   */
  activation: "softmax" | "sigmoid" | "none";
  /** Output indices that count as abuse. The score is the highest of them. */
  scoreIndices: number[];
  /** Optional model-specific correction applied to the probabilities before the highest is picked. */
  adjust?: (probabilities: number[]) => number[];
  /** Output label names by index, used to report which label gave the score. */
  labels?: string[];
}

/** Loads a real .onnx model file from disk and runs it via onnxruntime-node. */
export async function loadOnnxSession(modelPath: string): Promise<OnnxSession> {
  return InferenceSession.create(modelPath);
}

export class OnnxToxicityClassifier implements Classifier {
  constructor(private readonly session: OnnxSession, private readonly config: OnnxClassifierConfig) {}

  async classify(message: Message): Promise<ClassificationResult> {
    const windows = this.config.tokenizer.encode(message.text);
    let best: { score: number; index: number } | undefined;
    for (const window of windows) {
      const raw = await this.runWindow(window);
      const probabilities = this.config.adjust ? this.config.adjust(raw) : raw;
      for (const index of this.config.scoreIndices) {
        const score = probabilities[index];
        if (score === undefined) {
          throw new Error(`score index ${index} is out of range for an output of length ${probabilities.length}`);
        }
        if (!best || score > best.score) best = { score, index };
      }
    }
    if (!best) return { toxicityScore: 0, crossesAbuseThreshold: false };

    const label = this.config.labels?.[best.index];
    return { toxicityScore: best.score, crossesAbuseThreshold: best.score >= ABUSE_THRESHOLD, ...(label ? { label } : {}) };
  }

  private async runWindow({ inputIds, attentionMask }: TokenizedInput): Promise<number[]> {
    const dims = [1, inputIds.length];
    const { inputNames } = this.config;
    const feeds: Record<string, Tensor> = {
      [inputNames.inputIds]: new Tensor("int64", inputIds, dims),
      [inputNames.attentionMask]: new Tensor("int64", attentionMask, dims),
    };
    if (inputNames.tokenTypeIds) {
      feeds[inputNames.tokenTypeIds] = new Tensor("int64", new BigInt64Array(inputIds.length), dims);
    }

    const output = await this.session.run(feeds);
    const outputTensor = output[this.config.outputName];
    if (!outputTensor) {
      throw new Error(
        `model output has no tensor named "${this.config.outputName}" — got: ${Object.keys(output).join(", ")}`,
      );
    }
    const values = toNumberArray(outputTensor.data, this.config.outputName);
    if (this.config.activation === "softmax") return softmax(values);
    if (this.config.activation === "sigmoid") return values.map((x) => 1 / (1 + Math.exp(-x)));
    return values;
  }
}

/** A classification output tensor is numeric or int64 (bigint); a string tensor here means the model config points at the wrong output. */
function toNumberArray(data: ArrayLike<number> | ArrayLike<bigint> | readonly string[], outputName: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (typeof value === "string") {
      throw new Error(`model output "${outputName}" is a string tensor, not a numeric score`);
    }
    result.push(typeof value === "bigint" ? Number(value) : (value as number));
  }
  return result;
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}
