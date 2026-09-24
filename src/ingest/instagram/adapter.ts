import type { IngestAdapter, IngestResult } from "../adapter";
import { loadInstagramExport, parseInstagramExport } from "./reader";

export interface InstagramAdapterOptions {
  exportDir: string;
  selectedSenders: string[];
}

/**
 * A one-shot export folder, like the Android SMS export: nothing new
 * arrives after it's downloaded. Re-importing it (or a newer export) is
 * safe — message ids come from the raw record's hash, so a message
 * already in the vault is ignored, not duplicated.
 */
export class InstagramAdapter implements IngestAdapter {
  readonly source = "instagram" as const;

  constructor(private readonly options: InstagramAdapterOptions) {}

  async *acquire(): AsyncIterable<IngestResult> {
    const exp = await loadInstagramExport(this.options.exportDir);
    yield* parseInstagramExport(exp, this.options.selectedSenders);
  }
}
