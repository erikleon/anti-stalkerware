import { readFile } from "node:fs/promises";
import type { Vault } from "../vault/vault";
import type { SourceConfig } from "../vault/source-config";
import type { SourceKind } from "../types/message";
import type { MetadataSweepResult } from "../ingest/adapter";
import type { BlocklistSummary, ImapConnectionInput, SweepResponse, SyncResult } from "./api";
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
import { readMacosBlocklist, type BlockedIdentifier } from "../ingest/blocklist/macos-blocklist";
import { accountMatchesIdentifier, type KnownAccountStore } from "../vault/known-accounts";

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

/**
 * Reads this Mac's block list for onboarding, never throwing: a block
 * list that can't be read must not stop someone from importing their
 * messages. A read failure is returned as status "error" with the reason,
 * and the UI shows it, so it isn't silent either.
 */
export async function loadBlocklist(read: typeof readMacosBlocklist = readMacosBlocklist): Promise<{ summary: BlocklistSummary; entries: BlockedIdentifier[] }> {
  try {
    const result = await read();
    if (result.status !== "ok") return { summary: { status: result.status, blockedCount: 0, skipped: 0 }, entries: [] };
    return { summary: { status: "ok", blockedCount: result.entries.length, skipped: result.skipped }, entries: result.entries };
  } catch (err) {
    return { summary: { status: "error", blockedCount: 0, skipped: 0, error: (err as Error).message }, entries: [] };
  }
}

/**
 * Marks each scanned sender that is on this Mac's block list, or is
 * already a known account. Onboarding uses this to put blocked senders
 * first and pre-select them: their history from before the block is the
 * baseline OSINT later compares a new number against.
 */
export function annotateSweep(
  rows: readonly MetadataSweepResult[],
  knownAccounts: KnownAccountStore,
  blocked: readonly BlockedIdentifier[],
  summary: BlocklistSummary,
): SweepResponse {
  return {
    rows: rows.map((row) => {
      const known = knownAccounts.findMatch(row.sender);
      const isBlocked = blocked.some((entry) => accountMatchesIdentifier(entry, row.sender));
      return {
        ...row,
        blockedOnThisMac: isBlocked,
        ...(known ? { knownAccountLabel: known.personLabel } : {}),
      };
    }),
    blocklist: summary,
  };
}

/**
 * Saves the blocked senders the user chose to import as known accounts,
 * each under its own identifier as the person label until the user
 * groups them (a block list mixes spam with real people, so they're
 * never merged into one person automatically). Re-reads the block list
 * here rather than trusting the renderer's copy: only identifiers that
 * really are blocked on this Mac get the "macos-blocklist" origin.
 */
export async function saveBlockedAsKnown(
  knownAccounts: KnownAccountStore,
  identifiers: readonly string[],
  read: typeof readMacosBlocklist = readMacosBlocklist,
): Promise<{ added: number; alreadyKnown: number }> {
  const { entries } = await loadBlocklist(read);
  const inputs = identifiers.flatMap((identifier) => {
    const entry = entries.find((e) => accountMatchesIdentifier(e, identifier));
    return entry ? [{ personLabel: identifier, kind: entry.kind, value: identifier, origin: "macos-blocklist" as const }] : [];
  });
  return knownAccounts.addMany(inputs);
}

/** Imports this Mac's whole block list as known accounts, one person per entry. */
export async function importMacosBlocklist(
  knownAccounts: KnownAccountStore,
  read: typeof readMacosBlocklist = readMacosBlocklist,
): Promise<BlocklistSummary & { added: number; alreadyKnown: number }> {
  const { summary, entries } = await loadBlocklist(read);
  if (summary.status === "error") throw new Error(summary.error);
  const result = knownAccounts.addMany(
    entries.map((entry) => ({ personLabel: entry.value, kind: entry.kind, value: entry.value, origin: "macos-blocklist" as const })),
  );
  return { ...summary, ...result };
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
