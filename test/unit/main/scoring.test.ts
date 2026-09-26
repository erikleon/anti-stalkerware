import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../../helpers/tmp-dir";
import { initializeVault, openVault, type Vault } from "../../../src/vault/vault";
import { ScoringService, type ScoringStatus } from "../../../src/main/scoring";
import type { RawRecord } from "../../../src/types/message";

const MODELS_DIR = join(__dirname, "..", "..", "..", "models");

describe("ScoringService", () => {
  let dir: string;
  let vault: Vault | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "docket-scoring-"));
    await initializeVault(dir, "pass");
    vault = await openVault(dir, "pass");
  });

  afterEach(() => {
    vault?.close();
    removeTestDir(dir);
  });

  async function add(id: string, text: string): Promise<void> {
    const raw: RawRecord = { id, source: "android-sms", payload: Buffer.from(id), acquiredAt: new Date(), hash: `hash-${id}`, parserVersion: "1" };
    await vault!.store.append(raw, {
      id,
      rawRecordHash: raw.hash,
      source: "android-sms",
      threadId: "5551234567",
      sender: "+15551234567",
      fromSelf: false,
      text,
      sentAt: new Date("2026-01-01T00:00:00Z"),
      provenance: "live",
    });
  }

  it("scores an imported vault with the shipped model and opens the gate for a real threat", async () => {
    await add("m1", "I will kill you if you ever leave me");
    await add("m2", "Pickup is at 5:30 on Friday.");
    const statuses: ScoringStatus[] = [];
    const service = new ScoringService(MODELS_DIR, () => vault, (s) => statuses.push(s));

    await service.scoreVault();

    expect(statuses.map((s) => s.state)).toEqual(["loading", "scoring", "ready"]);
    expect(service.status()).toMatchObject({ state: "ready", lastRun: { scored: 2, crossed: 1, failed: 0 } });
    expect(await vault!.store.isAbusiveSender("+15551234567")).toBe(true);
  });

  it("queues one more pass when asked during a pass, so mid-pass imports get scored", async () => {
    await add("m1", "see you friday");
    const service = new ScoringService(MODELS_DIR, () => vault, () => undefined);
    const first = service.scoreVault();
    await add("m2", "I'm going to burn your car when you're asleep");
    await service.scoreVault();
    await first;
    expect(await vault!.store.isAbusiveSender("+15551234567")).toBe(true);
  });

  it("reports why when the model can't load, and never throws at the caller", async () => {
    await add("m1", "hello");
    const service = new ScoringService(join(dir, "no-models-here"), () => vault, () => undefined);
    await expect(service.scoreVault()).resolves.toBeUndefined();
    expect(service.status().state).toBe("error");
    expect(service.status().error).toMatch(/toxicity.json/);
  });

  it("does nothing when no vault is open", async () => {
    const statuses: ScoringStatus[] = [];
    const service = new ScoringService(MODELS_DIR, () => undefined, (s) => statuses.push(s));
    await service.scoreVault();
    expect(statuses).toEqual([]);
  });
});
