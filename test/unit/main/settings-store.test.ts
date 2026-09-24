import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../../../src/main/settings-store";

describe("SettingsStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-settings-store-test-"));
    filePath = join(dir, "settings.json");
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  it("returns defaults when no file exists yet", async () => {
    const store = new SettingsStore(filePath);
    expect(await store.get()).toEqual({ toastOnTriageAction: false, autoLockMinutes: 15 });
  });

  it("setToastOnTriageAction persists without disturbing autoLockMinutes", async () => {
    const store = new SettingsStore(filePath);
    await store.setToastOnTriageAction(true);
    expect(await store.get()).toEqual({ toastOnTriageAction: true, autoLockMinutes: 15 });
  });

  it("setAutoLockMinutes persists without disturbing toastOnTriageAction", async () => {
    const store = new SettingsStore(filePath);
    await store.setToastOnTriageAction(true);
    await store.setAutoLockMinutes(5);
    expect(await store.get()).toEqual({ toastOnTriageAction: true, autoLockMinutes: 5 });
  });

  it("0 disables auto-lock — a real, persisted value, not a special case", async () => {
    const store = new SettingsStore(filePath);
    await store.setAutoLockMinutes(0);
    expect((await store.get()).autoLockMinutes).toBe(0);
  });

  it("a fresh store reads what a previous one wrote", async () => {
    const store1 = new SettingsStore(filePath);
    await store1.setAutoLockMinutes(30);

    const store2 = new SettingsStore(filePath);
    expect((await store2.get()).autoLockMinutes).toBe(30);
  });

  it("falls back to defaults when the file is corrupted, rather than throwing", async () => {
    writeFileSync(filePath, "not valid json");
    const store = new SettingsStore(filePath);
    await expect(store.get()).resolves.toEqual({ toastOnTriageAction: false, autoLockMinutes: 15 });
  });

  it("fills in a missing field with its default when the file only has the other one", async () => {
    writeFileSync(filePath, JSON.stringify({ toastOnTriageAction: true }));
    const store = new SettingsStore(filePath);
    expect(await store.get()).toEqual({ toastOnTriageAction: true, autoLockMinutes: 15 });
  });
});
