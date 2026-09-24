import { dialog, ipcMain, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { registerGated, registerHandler, type IpcHandler } from "./ipc";
import type { VaultSession } from "./vault-session";
import type { SettingsStore } from "./settings-store";
import { listTriageRows, matchesBucket, countByBucket, type Bucket, type TriageRow } from "../triage/view";
import { buildExportPayload, listAllMessages, EXPORT_DISCLOSURE_TEXT } from "../vault/export";
import { listEligibility } from "../osint/eligibility";
import { rankCandidates } from "../osint/rank";
import { buildCandidate } from "../osint/verify";
import type { VaultStore } from "../vault/store";
import { DESTROY_CONFIRMATION_PHRASE, DESTROY_DISCLOSURE_TEXT, confirmationMatches, destroyVault } from "../vault/destroy";
import type { Message, SourceKind } from "../types/message";
import type { MetadataSweepResult } from "../ingest/adapter";
import * as onboarding from "./onboarding";
import type {
  CandidateInput,
  DestroyResult,
  ExportHistoryEntry,
  ExportResult,
  HotkeyStatus,
  ImapConnectionInput,
  OsintSenderEligibility,
  RankedLead,
  Settings,
  SourceStatus,
  StoredBoundary,
  StoredTaggedPhrase,
  SyncResult,
  UnlockResult,
} from "./api";

const SOURCE_LABELS: Array<{ source: SourceStatus["source"]; label: string }> = [
  { source: "imessage", label: "iMessage" },
  { source: "android-sms", label: "Android SMS export" },
  { source: "imap", label: "Email (IMAP)" },
];

/** Every VaultStore-touching handler needs an open vault; this is the one place that checks and throws, so no handler below has to remember to. */
function requireVault(session: VaultSession) {
  const vault = session.current();
  if (!vault) throw new Error("no vault is unlocked");
  return vault;
}

/** Every message from every thread a given sender appears in — usually one thread, but never assumed to be exactly one. Exported for osint-verify-integration.test.ts, which exercises this against a real SqliteVaultStore rather than a fake. */
export async function messagesFromSender(store: VaultStore, sender: string) {
  const threads = await store.listThreads();
  const matching = threads.filter((t) => t.sender === sender);
  const all = await Promise.all(matching.map((t) => store.list(t.threadId)));
  return all.flat();
}

/**
 * Binds a channel through registerHandler/registerGated (so the security
 * test suite's enumeration keeps working against the real app, not just
 * against test doubles) and wires the result to ipcMain.handle in the same
 * place, so a channel can never be registered without also being bound.
 * Every call also resets the inactivity clock (see VaultSession.touch) —
 * a real request from the renderer is by definition real activity, and
 * this is the one place every one of them passes through.
 */
function bind<Args extends unknown[], Result>(session: VaultSession, channel: string, handler: IpcHandler<Args, Result>): void {
  const registered = registerHandler(channel, handler);
  ipcMain.handle(channel, (_event, ...args) => {
    session.touch();
    return registered(...(args as Args));
  });
}

function bindGated<Args extends unknown[], Result>(
  channel: string,
  sender: (...args: Args) => string,
  session: VaultSession,
  handler: IpcHandler<Args, Result>,
): void {
  const registered = registerGated(channel, sender, () => session.current()?.store, handler);
  ipcMain.handle(channel, (_event, ...args) => {
    session.touch();
    return registered(...(args as Args));
  });
}

/** Registers every IPC channel the renderer can call — the concrete implementation behind window.docket (api.ts / preload.ts). */
export function registerHandlers(session: VaultSession, settings: SettingsStore, mainWindow: BrowserWindow, hotkeyStatus: HotkeyStatus): void {
  // Not vault-gated — the Support screen reads this from the lock screen
  // too, before any passphrase, same as its other content.
  bind<[], HotkeyStatus>(session, "support:hotkeyStatus", async () => hotkeyStatus);

  bind<[], boolean>(session, "vault:exists", async () => session.exists());
  bind<[string], UnlockResult>(session, "vault:initialize", async (passphrase) => ({ ok: await session.initialize(passphrase) }));
  bind<[string], UnlockResult>(session, "vault:unlock", async (passphrase) => ({ ok: await session.unlock(passphrase) }));
  bind<[], void>(session, "vault:lock", async () => session.lock());
  bind<[], boolean>(session, "vault:isUnlocked", async () => session.isUnlocked());

  bind<[Bucket], TriageRow[]>(session, "triage:listRows", async (bucket) => {
    const vault = requireVault(session);
    const rows = await listTriageRows(vault.store, vault.triageState, vault.userContext);
    return rows.filter((row) => matchesBucket(row, bucket));
  });
  bind<[], Record<Bucket, number>>(session, "triage:counts", async () => {
    const vault = requireVault(session);
    const rows = await listTriageRows(vault.store, vault.triageState, vault.userContext);
    return countByBucket(rows);
  });
  bind<[string], Message[]>(session, "triage:listMessages", async (threadId) => requireVault(session).store.list(threadId));
  bind<[string, boolean], void>(session, "triage:setReviewed", async (messageId, reviewed) => {
    requireVault(session).triageState.setReviewed(messageId, reviewed);
  });
  bind<[string, boolean], void>(session, "triage:setHidden", async (messageId, hidden) => {
    requireVault(session).triageState.setHidden(messageId, hidden);
  });

  bind<[], OsintSenderEligibility[]>(session, "osint:eligibleSenders", async () => listEligibility(requireVault(session).store));
  // The only OSINT-reaching channel, so the only one that goes through
  // registerGated. Verify-mode only (see DESIGN.md's OSINT collector
  // decision): checks the one candidate hypothesis the user just supplied
  // against this sender's own vault-held messages, never against any
  // external source and never able to discover a candidate from a bare
  // identifier alone. The gate is real: this still refuses a sender who
  // hasn't crossed the abuse threshold in the vault.
  bindGated<[string, CandidateInput], RankedLead>("osint:checkCandidate", (sender) => sender, session, async (sender, candidateInput) => {
    const store = requireVault(session).store;
    const senderMessages = await messagesFromSender(store, sender);
    const candidate = buildCandidate(candidateInput, sender, senderMessages);
    const [ranked] = rankCandidates([candidate]);
    return ranked!;
  });

  bind<[], Message[]>(session, "vaultExport:listAll", async () => listAllMessages(requireVault(session).store));
  bind<[], string>(session, "vaultExport:disclosureText", async () => EXPORT_DISCLOSURE_TEXT);
  bind<[], ExportResult | undefined>(session, "vaultExport:exportToFile", async () => exportToFile(session, mainWindow));
  bind<[], ExportHistoryEntry[]>(session, "vaultExport:history", async () => {
    const events = await requireVault(session).integrityLog.list();
    return events
      .filter((e) => e.kind === "export")
      .map((e) => ({ occurredAt: e.occurredAt, recordCount: e.recordHashes.length }));
  });

  bind<[], Settings>(session, "settings:get", async () => settings.get());
  bind<[boolean], void>(session, "settings:setToastOnTriageAction", async (value) => settings.setToastOnTriageAction(value));
  bind<[number], void>(session, "settings:setAutoLockMinutes", async (value) => settings.setAutoLockMinutes(value));
  bind<[], SourceStatus[]>(session, "settings:listSources", async () => {
    const vault = requireVault(session);
    return SOURCE_LABELS.map(({ source, label }) => ({
      source,
      label,
      connected: vault.sourceConfig.get(source) !== undefined,
    }));
  });

  bind<[], string | undefined>(session, "onboarding:pickFile", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"] });
    return canceled ? undefined : filePaths[0];
  });
  bind<[string], MetadataSweepResult[]>(session, "onboarding:sweepImessage", async (dbPath) => onboarding.sweepImessage(dbPath));
  bind<[string], MetadataSweepResult[]>(session, "onboarding:sweepAndroidSms", async (exportFilePath) => onboarding.sweepAndroidSms(exportFilePath));
  bind<[ImapConnectionInput], MetadataSweepResult[]>(session, "onboarding:sweepImap", async (connection) => onboarding.sweepImap(connection));
  bind<[string, string[]], SyncResult>(session, "onboarding:connectImessage", async (dbPath, selected) =>
    onboarding.connectImessage(requireVault(session), dbPath, selected),
  );
  bind<[string, string[]], SyncResult>(session, "onboarding:connectAndroidSms", async (exportFilePath, selected) =>
    onboarding.connectAndroidSms(requireVault(session), exportFilePath, selected),
  );
  bind<[ImapConnectionInput, string[]], SyncResult>(session, "onboarding:connectImap", async (connection, selected) =>
    onboarding.connectImapSource(requireVault(session), connection, selected),
  );
  bind<[SourceKind], SyncResult>(session, "onboarding:syncNow", async (source) => onboarding.syncNow(requireVault(session), source));
  bind<[SourceKind], void>(session, "onboarding:disconnect", async (source) => onboarding.disconnect(requireVault(session), source));

  bind<[], StoredBoundary[]>(session, "userContext:listBoundaries", async () => requireVault(session).userContext.listBoundaries());
  bind<[string, Date, string | undefined], StoredBoundary>(session, "userContext:addBoundary", async (description, setAt, appliesToSender) =>
    requireVault(session).userContext.addBoundary({ description, setAt, ...(appliesToSender ? { appliesToSender } : {}) }),
  );
  bind<[string], void>(session, "userContext:removeBoundary", async (id) => requireVault(session).userContext.removeBoundary(id));
  bind<[], StoredTaggedPhrase[]>(session, "userContext:listTaggedPhrases", async () => requireVault(session).userContext.listTaggedPhrases());
  bind<[string, string], StoredTaggedPhrase>(session, "userContext:addTaggedPhrase", async (phrase, note) =>
    requireVault(session).userContext.addTaggedPhrase({ phrase, note }),
  );
  bind<[string], void>(session, "userContext:removeTaggedPhrase", async (id) => requireVault(session).userContext.removeTaggedPhrase(id));

  bind<[], string>(session, "destroy:disclosureText", async () => DESTROY_DISCLOSURE_TEXT);
  bind<[], string>(session, "destroy:confirmationPhrase", async () => DESTROY_CONFIRMATION_PHRASE);
  bind<[string], DestroyResult>(session, "destroy:confirm", async (typedPhrase) => {
    if (!confirmationMatches({ expectedPhrase: DESTROY_CONFIRMATION_PHRASE, typedPhrase })) {
      return { removed: false, filesRemoved: [] };
    }
    const vaultDir = session.vaultDirectory;
    session.lock();
    const result = await destroyVault(vaultDir, { expectedPhrase: DESTROY_CONFIRMATION_PHRASE, typedPhrase });
    return { removed: true, filesRemoved: result.filesRemoved };
  });
}

async function exportToFile(session: VaultSession, mainWindow: BrowserWindow): Promise<ExportResult | undefined> {
  const vault = requireVault(session);
  const messages = await listAllMessages(vault.store);

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Export vault contents",
    defaultPath: `docket-export-${Date.now()}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (canceled || !filePath) return undefined;

  const payload = buildExportPayload(messages);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  await vault.integrityLog.append({
    kind: "export",
    recordHashes: messages.map((m) => m.rawRecordHash),
    occurredAt: new Date(),
  });

  return { filePath, messageCount: messages.length };
}
