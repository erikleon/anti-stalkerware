import { readFile } from "node:fs/promises";
import type { IngestAdapter, IngestResult } from "../adapter";
import { parseAndroidSmsExport } from "./reader";

export interface AndroidSmsAdapterOptions {
  exportFilePath: string;
  selectedAddresses: string[];
}

/**
 * A one-shot export file, not a live source — there's no "new since
 * last time" in the way a live database has. The checkpoint here is just
 * a position in the file's record list, so a large export can be resumed
 * without re-processing records already ingested, rather than meaning
 * "messages newer than this."
 */
export class AndroidSmsAdapter implements IngestAdapter {
  readonly source = "android-sms" as const;

  constructor(private readonly options: AndroidSmsAdapterOptions) {}

  async *acquire(sinceCheckpoint: string | undefined): AsyncIterable<IngestResult> {
    const startIndex = sinceCheckpoint ? Number(sinceCheckpoint) : 0;
    const xml = await readFile(this.options.exportFilePath);

    let index = 0;
    for (const result of parseAndroidSmsExport(xml, this.options.selectedAddresses)) {
      if (index >= startIndex) {
        yield result;
      }
      index++;
    }
  }
}
