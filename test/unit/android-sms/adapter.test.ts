import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AndroidSmsAdapter } from "../../../src/ingest/android-sms/adapter";

describe("AndroidSmsAdapter", () => {
  let dir: string;
  let exportPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-android-sms-test-"));
    exportPath = join(dir, "sms-backup.xml");
    writeFileSync(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="2">\n` +
        `<sms address="5551234567" date="1700000000000" type="1" body="first" />\n` +
        `<sms address="5551234567" date="1700000001000" type="1" body="second" />\n` +
        `</smses>`,
    );
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  it("reads every message with no checkpoint", async () => {
    const adapter = new AndroidSmsAdapter({ exportFilePath: exportPath, selectedAddresses: ["5551234567"] });
    const results = [];
    for await (const r of adapter.acquire(undefined)) results.push(r);
    expect(results).toHaveLength(2);
  });

  it("resumes from a checkpoint index without re-yielding earlier records", async () => {
    const adapter = new AndroidSmsAdapter({ exportFilePath: exportPath, selectedAddresses: ["5551234567"] });
    const results = [];
    for await (const r of adapter.acquire("1")) results.push(r);
    expect(results).toHaveLength(1);
    if (results[0]?.kind === "message") {
      expect(results[0].message.text).toBe("second");
    }
  });
});
