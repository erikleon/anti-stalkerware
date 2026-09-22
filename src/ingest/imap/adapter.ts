import type { IngestAdapter, IngestResult } from "../adapter";
import { connectImap, fetchNewMessages, type ImapConnectionConfig } from "./reader";

export interface ImapAdapterOptions {
  connection: ImapConnectionConfig;
  selectedSenders: string[];
}

export class ImapAdapter implements IngestAdapter {
  readonly source = "imap" as const;

  constructor(private readonly options: ImapAdapterOptions) {}

  async *acquire(sinceCheckpoint: string | undefined): AsyncIterable<IngestResult> {
    const sinceUid = sinceCheckpoint ? Number(sinceCheckpoint) : 0;
    const client = await connectImap(this.options.connection);
    try {
      yield* fetchNewMessages(client, this.options.selectedSenders, sinceUid);
    } finally {
      await client.logout();
    }
  }
}
