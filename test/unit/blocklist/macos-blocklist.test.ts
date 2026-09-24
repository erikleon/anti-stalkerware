import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bplist from "bplist-creator";
import { removeTestDir } from "../../helpers/tmp-dir";
import { parseMacosBlocklist, readMacosBlocklist } from "../../../src/ingest/blocklist/macos-blocklist";

function buildBlocklist(items: Array<Record<string, unknown>>): Buffer {
  return bplist({
    __kCMFBlockListStoreTopLevelKey: {
      __kCMFBlockListStoreVersionKey: 1,
      __kCMFBlockListStoreArrayKey: items,
      __kCMFBlockListStoreTypeKey: "com.apple.cmfsyncagent.storedata",
    },
  });
}

describe("parseMacosBlocklist", () => {
  it("reads phone and email entries", () => {
    const plist = buildBlocklist([
      { __kCMFItemPhoneNumberUnformattedKey: "+15551234567", __kCMFItemPhoneNumberCountryCodeKey: "us", __kCMFItemTypeKey: 0 },
      { __kCMFItemEmailUnformattedKey: "ex@example.com", __kCMFItemTypeKey: 1 },
    ]);
    expect(parseMacosBlocklist(plist)).toEqual({
      entries: [
        { kind: "phone", value: "+15551234567" },
        { kind: "email", value: "ex@example.com" },
      ],
      skipped: 0,
    });
  });

  it("counts an entry it can't read instead of dropping it silently", () => {
    const plist = buildBlocklist([{ __kCMFItemTypeKey: 2, __kCMFItemBusinessIdKey: "biz-123" }, { __kCMFItemPhoneNumberUnformattedKey: "+15551234567" }]);
    const parsed = parseMacosBlocklist(plist);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
  });

  it("throws a plain error for a file with a different layout", () => {
    expect(() => parseMacosBlocklist(bplist({ somethingElse: true }))).toThrow(/unexpected layout/);
  });

  it("throws a plain error for bytes that aren't a property list", () => {
    expect(() => parseMacosBlocklist(Buffer.from("not a plist"))).toThrow(/not a readable property list/);
  });
});

describe("readMacosBlocklist", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-blocklist-test-"));
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  it("says the platform isn't supported off macOS, without touching the file", async () => {
    expect(await readMacosBlocklist(join(dir, "missing.plist"), "win32")).toEqual({ status: "unsupported-platform" });
  });

  it("reports not-found when no block list exists", async () => {
    expect(await readMacosBlocklist(join(dir, "missing.plist"), "darwin")).toEqual({ status: "not-found" });
  });

  it("reads a real file on macOS", async () => {
    const path = join(dir, "com.apple.cmfsyncagent.plist");
    writeFileSync(path, buildBlocklist([{ __kCMFItemPhoneNumberUnformattedKey: "+15551234567" }]));
    expect(await readMacosBlocklist(path, "darwin")).toEqual({
      status: "ok",
      entries: [{ kind: "phone", value: "+15551234567" }],
      skipped: 0,
    });
  });
});
