import { readFile } from "node:fs/promises";
import type { Vault } from "../vault/vault";
import type { SourceConfig } from "../vault/source-config";
import type { SourceKind } from "../types/message";
import type { MetadataSweepResult } from "../ingest/adapter";
import type { ImapConnectionInput, SyncResult } from "./api";
import { openChatDbReadOnly } from "../ingest/imessage/reader";
import { sweepMessageMetadata } from "../ingest/imessage/metadata-sweep";
import { ImessageAdapter } from "../ingest/imessage/adapter";
import { sweepAndroidSmsExport } from "../ingest/android-sms/metadata-sweep";
import { AndroidSmsAdapter } from "../ingest/android-sms/adapter";
import { connectImap } from "../ingest/imap/reader";
import { sweepImapSenders } from "../ingest/imap/metadata-sweep";
import { ImapAdapter } from "../ingest/imap/adapter";
import { runIngest } from "../pipeline/run-ingest";
import { expandHome } from "./paths";

/**
 * The logic behind onboarding's IPC channels — one function per step, each
 * source's specifics contained here so handlers.ts stays a thin binding
 * layer. No classifier is passed to runIngest here: no ONNX model ships
 * with the app (see score/classifier.ts), so a first sync always appends
 * unclassified and a later classification pass (once a model exists) can
 * reclassify — append() is idempotent per hash, reclassifying isn't a
 * correctness problem, just wasted work (see run-ingest.ts).
 */

export async function sweepImessage(dbPath: string): Promise<MetadataSweepResult[]> {
  const db = await openChatDbReadOnly(expandHome(dbPath));
  try {
    return sweepMessageMetadata(db);
  } finally {
    db.close();
  }
}

export async function sweepAndroidSms(exportFilePath: string): Promise<MetadataSweepResult[]> {
  const xml = await readFile(exportFilePath);
  return sweepAndroidSmsExport(xml);
}

export async function sweepImap(connection: ImapConnectionInput): Promise<MetadataSweepResult[]> {
  const client = await connectImap(toImapConnectionConfig(connection));
  try {
    return await sweepImapSenders(client);
  } finally {
    await client.logout();
  }
}

export async function connectImessage(vault: Vault, dbPath: string, selectedIdentifiers: string[]): Promise<SyncResult> {
  // Expanded once, here, and the expanded form is what gets saved — so a
  // later syncNow() reading config.dbPath back out never needs to expand
  // it again.
  const resolvedDbPath = expandHome(dbPath);
  const config: SourceConfig = { source: "imessage", dbPath: resolvedDbPath, selectedIdentifiers };
  vault.sourceConfig.save(config);
  const adapter = new ImessageAdapter({ dbPath: resolvedDbPath, selectedThreadIdentifiers: selectedIdentifiers });
  return runIngest(adapter, vault.store, undefined, undefined);
}

export async function connectAndroidSms(vault: Vault, exportFilePath: string, selectedIdentifiers: string[]): Promise<SyncResult> {
  const config: SourceConfig = { source: "android-sms", exportFilePath, selectedIdentifiers };
  vault.sourceConfig.save(config);
  const adapter = new AndroidSmsAdapter({ exportFilePath, selectedAddresses: selectedIdentifiers });
  return runIngest(adapter, vault.store, undefined, undefined);
}

export async function connectImapSource(vault: Vault, connection: ImapConnectionInput, selectedIdentifiers: string[]): Promise<SyncResult> {
  const config: SourceConfig = {
    source: "imap",
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    user: connection.user,
    mailbox: connection.mailbox,
    selectedIdentifiers,
  };
  vault.sourceConfig.save(config);
  await vault.credentials.save({ account: connection.user, secret: connection.appPassword, kind: "app-password" });

  const adapter = new ImapAdapter({ connection: toImapConnectionConfig(connection), selectedSenders: selectedIdentifiers });
  return runIngest(adapter, vault.store, undefined, undefined);
}

export async function syncNow(vault: Vault, source: SourceKind): Promise<SyncResult> {
  const config = vault.sourceConfig.get(source);
  if (!config) throw new Error(`${source} isn't connected yet`);

  if (config.source === "imessage") {
    const adapter = new ImessageAdapter({ dbPath: config.dbPath, selectedThreadIdentifiers: config.selectedIdentifiers });
    return runIngest(adapter, vault.store, undefined, undefined);
  }
  if (config.source === "android-sms") {
    const adapter = new AndroidSmsAdapter({ exportFilePath: config.exportFilePath, selectedAddresses: config.selectedIdentifiers });
    return runIngest(adapter, vault.store, undefined, undefined);
  }

  const credential = await vault.credentials.get(config.user);
  if (!credential) throw new Error(`no stored credential for ${config.user} — reconnect this source`);
  const adapter = new ImapAdapter({
    connection: { host: config.host, port: config.port, secure: config.secure, user: config.user, mailbox: config.mailbox, appPassword: credential.secret },
    selectedSenders: config.selectedIdentifiers,
  });
  return runIngest(adapter, vault.store, undefined, undefined);
}

export async function disconnect(vault: Vault, source: SourceKind): Promise<void> {
  const config = vault.sourceConfig.get(source);
  if (config?.source === "imap") {
    await vault.credentials.remove(config.user);
  }
  vault.sourceConfig.remove(source);
}

function toImapConnectionConfig(connection: ImapConnectionInput) {
  return {
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    user: connection.user,
    appPassword: connection.appPassword,
    mailbox: connection.mailbox,
  };
}
