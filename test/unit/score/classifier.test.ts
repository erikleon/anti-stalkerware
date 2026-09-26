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
  encode: (text) => [
    {
      inputIds: text.split(" ").map((_, i) => BigInt(i + 1)),
      attentionMask: text.split(" ").map(() => 1n),
    },
  ],
};

function baseConfig(overrides: Partial<OnnxClassifierConfig> = {}): OnnxClassifierConfig {
  return {
    tokenizer: fakeTokenizer,
    inputNames: { inputIds: "input_ids", attentionMask: "attention_mask" },
    outputName: "logits",
    activation: "none",
    scoreIndices: [1],
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
    const classifier = new OnnxToxicityClassifier(session, baseConfig({ activation: "softmax" }));
    const result = await classifier.classify(msg("test"));
    expect(result.toxicityScore).toBeGreaterThan(0.99);
  });

  it("respects a configured score index other than 1", async () => {
    const session = fakeSession({ logits: { data: [0.8, 0.2] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig({ scoreIndices: [0] }));
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

  it("throws a clear error when a score index is out of range", async () => {
    const session = fakeSession({ logits: { data: [0.5, 0.5] } });
    const classifier = new OnnxToxicityClassifier(session, baseConfig({ scoreIndices: [5] }));
    await expect(classifier.classify(msg("test"))).rejects.toThrow(/out of range/);
  });

  it("applies sigmoid per label for a multi-label model and reports the winning label", async () => {
    // Logits for toxic, obscene, threat: only threat is confidently on.
    const session = fakeSession({ logits: { data: [-3, 4, 3] } });
    const classifier = new OnnxToxicityClassifier(
      session,
      baseConfig({ activation: "sigmoid", scoreIndices: [0, 2], labels: ["toxic", "obscene", "threat"] }),
    );
    const result = await classifier.classify(msg("test"));
    // obscene (index 1) scores higher but isn't a score index, so it's ignored.
    expect(result.label).toBe("threat");
    expect(result.toxicityScore).toBeCloseTo(1 / (1 + Math.exp(-3)), 6);
    expect(result.crossesAbuseThreshold).toBe(true);
  });

  it("scores every window of a long text and keeps the highest", async () => {
    const windows: Tokenizer = { encode: () => [0, 1, 2].map((i) => ({ inputIds: [BigInt(i)], attentionMask: [1n] })) };
    const scores = [0.1, 0.95, 0.2];
    let call = 0;
    const session: OnnxSession = { run: async () => ({ logits: { data: [0, scores[call++]!] } }) };
    const result = await new OnnxToxicityClassifier(session, baseConfig({ tokenizer: windows })).classify(msg("long"));
    expect(call).toBe(3);
    expect(result.toxicityScore).toBe(0.95);
  });

  it("sends an all-zero token_type_ids tensor when the model takes one", async () => {
    let captured: Record<string, Tensor> | undefined;
    const session: OnnxSession = {
      run: async (feeds) => {
        captured = feeds;
        return { logits: { data: [0.5, 0.5] } };
      },
    };
    const config = baseConfig({ inputNames: { inputIds: "input_ids", attentionMask: "attention_mask", tokenTypeIds: "token_type_ids" } });
    await new OnnxToxicityClassifier(session, config).classify(msg("two words"));
    expect(Array.from(captured!["token_type_ids"]!.data as BigInt64Array)).toEqual([0n, 0n]);
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
