import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { Settings } from "./api";

/**
 * A handful of non-sensitive UI preferences (currently just the D10
 * confirmation-toast toggle). Deliberately outside the vault: these apply
 * whether or not a vault has even been created yet, and none of them are
 * evidence or credentials, so they don't need encryption at rest.
 */
const DEFAULT_SETTINGS: Settings = { toastOnTriageAction: false };

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<Settings> {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS };
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    } catch {
      // A corrupted preferences file isn't worth surfacing as an error —
      // falling back to defaults is safe and keeps the app usable.
      return { ...DEFAULT_SETTINGS };
    }
  }

  async setToastOnTriageAction(value: boolean): Promise<void> {
    const current = await this.get();
    await writeFile(this.filePath, JSON.stringify({ ...current, toastOnTriageAction: value }, null, 2), "utf8");
  }
}
