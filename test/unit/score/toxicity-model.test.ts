import { beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../../helpers/tmp-dir";
import { createBertWindowTokenizer, loadToxicityModel, type LoadedToxicityModel } from "../../../src/score/toxicity-model";
import type { Message } from "../../../src/types/message";

/**
 * Runs the real, shipped model (models/toxicity, fetched by
 * scripts/fetch-assets.mjs, which `npm test` runs first). The examples
 * below are the ones the swearing adjustment in toxicity-model.ts was
 * calibrated on; they're checks that the model behaves as documented,
 * not a benchmark.
 */
const MODELS_DIR = join(__dirname, "..", "..", "..", "models");

function message(text: string): Message {
  return { id: "m", rawRecordHash: "h", source: "imessage", threadId: "t", sender: "s", fromSelf: false, text, sentAt: new Date(), provenance: "live" };
}

describe("createBertWindowTokenizer", () => {
  const tokenizer = createBertWindowTokenizer(
    JSON.parse(readFileSync(join(MODELS_DIR, "toxicity", "tokenizer.json"), "utf8")),
    JSON.parse(readFileSync(join(MODELS_DIR, "toxicity", "tokenizer_config.json"), "utf8")),
  );

  it("matches the reference BERT uncased token ids, including accents, curly quotes, and an emoji", () => {
    // Reference ids from Hugging Face's tokenizer for this model's tokenizer.json.
    const [window] = tokenizer.encode("Hello, you CAN’T hide — café 😀");
    expect(window!.inputIds.map(Number)).toEqual([101, 7592, 1010, 2017, 2064, 1521, 1056, 5342, 1517, 7668, 100, 102]);
    expect(window!.attentionMask.every((m) => m === 1n)).toBe(true);
  });

  it("splits long text into 512-token windows instead of cutting it off", () => {
    // One "sentence", so only the whole-text windows.
    const windows = tokenizer.encode("word ".repeat(1200));
    expect(windows).toHaveLength(3);
    for (const w of windows) {
      expect(w.inputIds.length).toBeLessThanOrEqual(512);
      expect(w.inputIds[0]).toBe(101n);
      expect(w.inputIds[w.inputIds.length - 1]).toBe(102n);
    }
    expect(windows.reduce((sum, w) => sum + w.inputIds.length - 2, 0)).toBe(1200);
  });

  it("adds one window per sentence when the text has more than one", () => {
    const windows = tokenizer.encode("First sentence. Second one!\nA third line");
    expect(windows).toHaveLength(4);
    expect(windows[1]!.inputIds.map(Number)).toEqual(tokenizer.encode("First sentence.")[0]!.inputIds.map(Number));
  });

  it("gives an empty text one window with only [CLS] and [SEP]", () => {
    expect(tokenizer.encode("").map((w) => w.inputIds.map(Number))).toEqual([[101, 102]]);
  });
});

describe("loadToxicityModel", () => {
  let model: LoadedToxicityModel;

  beforeAll(async () => {
    model = await loadToxicityModel(MODELS_DIR);
  });

  it("reports the pinned model and revision as its version", () => {
    expect(model.version).toBe("minuva/MiniLMv2-toxic-jigsaw-onnx@c035f27b6a6d68770f8069a4829f1715a48b8d51");
  });

  it.each([
    ["I will kill you if you ever leave me", "threat"],
    ["I'm going to burn your car when you're asleep", "threat"],
    ["you are a worthless stupid bitch and everyone knows it", "insult"],
    ["you're a fucking liar and a terrible mother", "insult"],
  ])("flags overt abuse: %s", async (text, label) => {
    const result = await model.classifier.classify(message(text));
    expect(result.crossesAbuseThreshold).toBe(true);
    expect(result.label).toBe(label);
  });

  it.each(["Pickup is at 5:30 on Friday. I'll bring her backpack.", "did you get the slides for tomorrow's meeting?"])(
    "scores an ordinary message near zero: %s",
    async (text) => {
      expect((await model.classifier.classify(message(text))).toxicityScore).toBeLessThan(0.05);
    },
  );

  it.each(["lol fuck yes, see you there", "holy shit that game last night was amazing", "this traffic is fucking ridiculous"])(
    "does not flag friendly swearing: %s",
    async (text) => {
      // Raw "toxic" is 0.89-0.98 for these; the swearing adjustment keeps them below the Medium band.
      expect((await model.classifier.classify(message(text))).toxicityScore).toBeLessThan(0.4);
    },
  );

  it("keeps a veiled threat with no swearing in the Medium band", async () => {
    const result = await model.classifier.classify(message("you better watch your back tonight"));
    expect(result.toxicityScore).toBeGreaterThanOrEqual(0.4);
    expect(result.crossesAbuseThreshold).toBe(false);
  });

  it("does not catch coercion that reads as polite — that's what structural signals are for", async () => {
    // Documented limit, not a goal: these score near zero.
    for (const text of ["i know where you're staying now", "I'll make sure you never see the kids again"]) {
      expect((await model.classifier.classify(message(text))).toxicityScore).toBeLessThan(0.1);
    }
  });

  it("finds a threat at the end of a message longer than one window", async () => {
    const result = await model.classifier.classify(message(`${"we need to talk about the schedule. ".repeat(120)}I will kill you if you ever leave me`));
    expect(result.crossesAbuseThreshold).toBe(true);
  });

  it("refuses a model file that doesn't match its pinned hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docket-model-test-"));
    try {
      cpSync(MODELS_DIR, dir, { recursive: true });
      writeFileSync(join(dir, "toxicity", "config.json"), "{}");
      await expect(loadToxicityModel(dir)).rejects.toThrow(/config.json doesn't match models\/toxicity.json/);
    } finally {
      removeTestDir(dir);
    }
  });

  it("says how to get the model when a file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docket-model-test-"));
    try {
      cpSync(join(MODELS_DIR, "toxicity.json"), join(dir, "toxicity.json"));
      await expect(loadToxicityModel(dir)).rejects.toThrow(/is missing .*npm run fetch-assets/);
    } finally {
      removeTestDir(dir);
    }
  });
});
