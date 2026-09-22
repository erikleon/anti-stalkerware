import { describe, expect, it } from "vitest";
import { Tensor } from "onnxruntime-node";
import { OnnxToxicityClassifier, ABUSE_THRESHOLD, loadOnnxSession, type OnnxSession, type OnnxClassifierConfig, type Tokenizer } from "../../../src/score/classifier";
import type { Message } from "../../../src/types/message";

function msg(text: string): Message {
  return {
    id: "m1",
    rawRecordHash: "h1",
    source: "imessage",
    threadId: "thread-a",
    sender: "stalker@example.com",
    fromSelf: false,
    text,
    sentAt: new Date(),
    provenance: "live",
  };
}

const fakeTokenizer: Tokenizer = {
  encode: (text) => ({
    inputIds: text.split(" ").map((_, i) => BigInt(i + 1)),
    attentionMask: text.split(" ").map(() => 1n),
  }),
};

function baseConfig(overrides: Partial<OnnxClassifierConfig> = {}): OnnxClassifierConfig {
  return {
    tokenizer: fakeTokenizer,
    inputNames: { inputIds: "input_ids", attentionMask: "attention_mask" },
    outputName: "logits",
    toxicClassIndex: 1,
    outputIsLogits: false,
    ...overrides,
  };
}

function fakeSession(output: Record<string, { data: ArrayLike<number> | ArrayLike<bigint> | readonly string[] }>): OnnxSession {
  return { run: async () => output };
}

describe("OnnxToxicityClassifier", () => {
  it("classifies as crossing the threshold when the model's probability meets it", async () => {
    const session = fakeSession({ logits: { data: [0.1, 0.9] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig());
    const result = await classifier.classify(msg("you are worthless"));
    expect(result.toxicityScore).toBe(0.9);
    expect(result.crossesAbuseThreshold).toBe(true);
  });

  it("does not cross the threshold when the score is below it", async () => {
    const session = fakeSession({ logits: { data: [0.9, 0.1] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig());
    const result = await classifier.classify(msg("how are you"));
    expect(result.crossesAbuseThreshold).toBe(false);
  });

  it("uses exactly ABUSE_THRESHOLD as the crossing point", async () => {
    const session = fakeSession({ logits: { data: [1 - ABUSE_THRESHOLD, ABUSE_THRESHOLD] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig());
    const result = await classifier.classify(msg("borderline"));
    expect(result.crossesAbuseThreshold).toBe(true);
  });

  it("applies softmax when the model outputs raw logits", async () => {
    // Large logit gap should softmax to something close to (0, 1).
    const session = fakeSession({ logits: { data: [-10, 10] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig({ outputIsLogits: true }));
    const result = await classifier.classify(msg("test"));
    expect(result.toxicityScore).toBeGreaterThan(0.99);
  });

  it("respects a configured toxicClassIndex other than 1", async () => {
    const session = fakeSession({ logits: { data: [0.8, 0.2] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig({ toxicClassIndex: 0 }));
    const result = await classifier.classify(msg("test"));
    expect(result.toxicityScore).toBe(0.8);
  });

  it("handles an int64 (bigint) output tensor", async () => {
    const session = fakeSession({ logits: { data: [0n, 1n] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig());
    const result = await classifier.classify(msg("test"));
    expect(result.toxicityScore).toBe(1);
  });

  it("constructs input tensors with the configured names and matching dims", async () => {
    let capturedFeeds: Record<string, Tensor> | undefined;
    const session: OnnxSession = {
      run: async (feeds) => {
        capturedFeeds = feeds;
        return { logits: { data: [0.5, 0.5] } };
      },
    };
    const classifier = new OnnxToxicityClassifier(session, baseConfig());
    await classifier.classify(msg("two words"));

    expect(capturedFeeds).toBeDefined();
    expect(capturedFeeds!["input_ids"]).toBeInstanceOf(Tensor);
    expect(capturedFeeds!["attention_mask"]).toBeInstanceOf(Tensor);
    expect(capturedFeeds!["input_ids"]!.dims).toEqual([1, 2]);
  });

  it("throws a clear error when the configured output name isn't in the model's output", async () => {
    const session = fakeSession({ wrong_name: { data: [0.5, 0.5] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig({ outputName: "logits" }));
    await expect(classifier.classify(msg("test"))).rejects.toThrow(/no tensor named "logits"/);
  });

  it("throws a clear error when toxicClassIndex is out of range", async () => {
    const session = fakeSession({ logits: { data: [0.5, 0.5] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig({ toxicClassIndex: 5 }));
    await expect(classifier.classify(msg("test"))).rejects.toThrow(/out of range/);
  });

  it("throws a clear error when the output tensor is a string tensor", async () => {
    const session = fakeSession({ logits: { data: ["not", "a", "score"] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig());
    await expect(classifier.classify(msg("test"))).rejects.toThrow(/string tensor/);
  });
});

describe("loadOnnxSession", () => {
  it("rejects clearly when the model file doesn't exist", async () => {
    await expect(loadOnnxSession("/nonexistent/path/model.onnx")).rejects.toThrow();
  });
});
