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
 * No specific model is bundled or assumed here. Tokenization, tensor
 * names, and how to read the output are all injected rather than
 * hardcoded, because those are properties of whichever specific ONNX
 * model actually gets shipped — a decision this code deliberately doesn't
 * make on its own. Wiring up a real model means providing a Tokenizer
 * matching its vocabulary and an OnnxClassifierConfig matching its input/
 * output tensor names, not editing this file.
 */
export interface ClassificationResult {
  toxicityScore: number;
  crossesAbuseThreshold: boolean;
}

export interface Classifier {
  classify(message: Message): Promise<ClassificationResult>;
}

export const ABUSE_THRESHOLD = 0.7;

export interface TokenizedInput {
  inputIds: bigint[];
  attentionMask: bigint[];
}

/** Turns text into model input. Model-specific (vocabulary, special tokens, max length) — provided by whoever wires up a real model, not this file. */
export interface Tokenizer {
  encode(text: string): TokenizedInput;
}

/** The slice of onnxruntime-node's InferenceSession this classifier needs — narrow on purpose so tests can inject a fake session instead of a real model file. */
export interface OnnxSession {
  run(feeds: Record<string, Tensor>): Promise<Record<string, { data: ArrayLike<number> | ArrayLike<bigint> | readonly string[] }>>;
}

export interface OnnxClassifierConfig {
  tokenizer: Tokenizer;
  /** Tensor names this specific model's graph expects as input. */
  inputNames: { inputIds: string; attentionMask: string };
  /** Tensor name this specific model's graph produces as output. */
  outputName: string;
  /** Index into the output tensor's class dimension that means "toxic". Model-specific — not assumed to be 1 for every model. */
  toxicClassIndex: number;
  /** True if the output tensor holds raw logits needing softmax; false if it's already a probability distribution. */
  outputIsLogits: boolean;
}

/** Loads a real .onnx model file from disk and runs it via onnxruntime-node. */
export async function loadOnnxSession(modelPath: string): Promise<OnnxSession> {
  return InferenceSession.create(modelPath);
}

export class OnnxToxicityClassifier implements Classifier {
  constructor(private readonly session: OnnxSession, private readonly config: OnnxClassifierConfig) {}

  async classify(message: Message): Promise<ClassificationResult> {
    const { inputIds, attentionMask } = this.config.tokenizer.encode(message.text);
    const dims = [1, inputIds.length];

    const feeds: Record<string, Tensor> = {
      [this.config.inputNames.inputIds]: new Tensor("int64", inputIds, dims),
      [this.config.inputNames.attentionMask]: new Tensor("int64", attentionMask, dims),
    };

    const output = await this.session.run(feeds);
    const outputTensor = output[this.config.outputName];
    if (!outputTensor) {
      throw new Error(
        `model output has no tensor named "${this.config.outputName}" — got: ${Object.keys(output).join(", ")}`,
      );
    }

    const values = toNumberArray(outputTensor.data, this.config.outputName);
    const probabilities = this.config.outputIsLogits ? softmax(values) : values;
    const toxicityScore = probabilities[this.config.toxicClassIndex];
    if (toxicityScore === undefined) {
      throw new Error(
        `toxicClassIndex ${this.config.toxicClassIndex} is out of range for an output of length ${values.length}`,
      );
    }

    return { toxicityScore, crossesAbuseThreshold: toxicityScore >= ABUSE_THRESHOLD };
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
