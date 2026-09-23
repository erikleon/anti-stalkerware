import { dialog, ipcMain, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { registerGated, registerHandler, type IpcHandler } from "./ipc";
import type { VaultSession } from "./vault-session";
import type { SettingsStore } from "./settings-store";
import { listTriageRows, matchesBucket, countByBucket, type Bucket, type TriageRow } from "../triage/view";
import { buildExportPayload, listAllMessages, EXPORT_DISCLOSURE_TEXT } from "../vault/export";
import { listEligibility } from "../osint/eligibility";
import { rankCandidates } from "../osint/rank";
import { DESTROY_CONFIRMATION_PHRASE, DESTROY_DISCLOSURE_TEXT, confirmationMatches, destroyVault } from "../vault/destroy";
import type { Message, SourceKind } from "../types/message";
import type { MetadataSweepResult } from "../ingest/adapter";
import * as onboarding from "./onboarding";
import type {
  DestroyResult,
  ExportHistoryEntry,
  ExportResult,
  ImapConnectionInput,
  OsintSenderEligibility,
  RankedLead,
  Settings,
  SourceStatus,
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

/**
 * Binds a channel through registerHandler/registerGated (so the security
 * test suite's enumeration keeps working against the real app, not just
 * against test doubles) and wires the result to ipcMain.handle in the same
 * place, so a channel can never be registered without also being bound.
 */
function bind<Args extends unknown[], Result>(channel: string, handler: IpcHandler<Args, Result>): void {
  const registered = registerHandler(channel, handler);
  ipcMain.handle(channel, (_event, ...args) => registered(...(args as Args)));
}

function bindGated<Args extends unknown[], Result>(
  channel: string,
  sender: (...args: Args) => string,
  session: VaultSession,
  handler: IpcHandler<Args, Result>,
): void {
  const registered = registerGated(channel, sender, () => session.current()?.store, handler);
  ipcMain.handle(channel, (_event, ...args) => registered(...(args as Args)));
}

/** Registers every IPC channel the renderer can call — the concrete implementation behind window.antistalker (api.ts / preload.ts). */
export function registerHandlers(session: VaultSession, settings: SettingsStore, mainWindow: BrowserWindow): void {
  bind<[], boolean>("vault:exists", async () => session.exists());
  bind<[string], UnlockResult>("vault:initialize", async (passphrase) => ({ ok: await session.initialize(passphrase) }));
  bind<[string], UnlockResult>("vault:unlock", async (passphrase) => ({ ok: await session.unlock(passphrase) }));
  bind<[], void>("vault:lock", async () => session.lock());
  bind<[], boolean>("vault:isUnlocked", async () => session.isUnlocked());

  bind<[Bucket], TriageRow[]>("triage:listRows", async (bucket) => {
    const vault = requireVault(session);
    const rows = await listTriageRows(vault.store, vault.triageState, vault.userContext);
    return rows.filter((row) => matchesBucket(row, bucket));
  });
  bind<[], Record<Bucket, number>>("triage:counts", async () => {
    const vault = requireVault(session);
    const rows = await listTriageRows(vault.store, vault.triageState, vault.userContext);
    return countByBucket(rows);
  });
  bind<[string], Message[]>("triage:listMessages", async (threadId) => requireVault(session).store.list(threadId));
  bind<[string, boolean], void>("triage:setReviewed", async (messageId, reviewed) => {
    requireVault(session).triageState.setReviewed(messageId, reviewed);
  });
  bind<[string, boolean], void>("triage:setHidden", async (messageId, hidden) => {
    requireVault(session).triageState.setHidden(messageId, hidden);
  });

  bind<[], OsintSenderEligibility[]>("osint:eligibleSenders", async () => listEligibility(requireVault(session).store));
  // The only OSINT-reaching channel, so the only one that goes through
  // registerGated. Always returns [] today — no live signal-gathering
  // collector exists yet (deliberately deferred; see the plan). The gate
  // itself is real: this still refuses a sender who hasn't crossed the
  // abuse threshold in the vault.
  bindGated<[string], RankedLead[]>("osint:rank", (sender) => sender, session, async () => rankCandidates([]));

  bind<[], Message[]>("vaultExport:listAll", async () => listAllMessages(requireVault(session).store));
  bind<[], string>("vaultExport:disclosureText", async () => EXPORT_DISCLOSURE_TEXT);
  bind<[], ExportResult | undefined>("vaultExport:exportToFile", async () => exportToFile(session, mainWindow));
  bind<[], ExportHistoryEntry[]>("vaultExport:history", async () => {
    const events = await requireVault(session).integrityLog.list();
    return events
      .filter((e) => e.kind === "export")
      .map((e) => ({ occurredAt: e.occurredAt, recordCount: e.recordHashes.length }));
  });

  bind<[], Settings>("settings:get", async () => settings.get());
  bind<[boolean], void>("settings:setToastOnTriageAction", async (value) => settings.setToastOnTriageAction(value));
  bind<[], SourceStatus[]>("settings:listSources", async () => {
    const vault = requireVault(session);
    return SOURCE_LABELS.map(({ source, label }) => ({
      source,
      label,
      connected: vault.sourceConfig.get(source) !== undefined,
    }));
  });

  bind<[], string | undefined>("onboarding:pickFile", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"] });
    return canceled ? undefined : filePaths[0];
  });
  bind<[string], MetadataSweepResult[]>("onboarding:sweepImessage", async (dbPath) => onboarding.sweepImessage(dbPath));
  bind<[string], MetadataSweepResult[]>("onboarding:sweepAndroidSms", async (exportFilePath) => onboarding.sweepAndroidSms(exportFilePath));
  bind<[ImapConnectionInput], MetadataSweepResult[]>("onboarding:sweepImap", async (connection) => onboarding.sweepImap(connection));
  bind<[string, string[]], SyncResult>("onboarding:connectImessage", async (dbPath, selected) =>
    onboarding.connectImessage(requireVault(session), dbPath, selected),
  );
  bind<[string, string[]], SyncResult>("onboarding:connectAndroidSms", async (exportFilePath, selected) =>
    onboarding.connectAndroidSms(requireVault(session), exportFilePath, selected),
  );
  bind<[ImapConnectionInput, string[]], SyncResult>("onboarding:connectImap", async (connection, selected) =>
    onboarding.connectImapSource(requireVault(session), connection, selected),
  );
  bind<[SourceKind], SyncResult>("onboarding:syncNow", async (source) => onboarding.syncNow(requireVault(session), source));
  bind<[SourceKind], void>("onboarding:disconnect", async (source) => onboarding.disconnect(requireVault(session), source));

  bind<[], string>("destroy:disclosureText", async () => DESTROY_DISCLOSURE_TEXT);
  bind<[], string>("destroy:confirmationPhrase", async () => DESTROY_CONFIRMATION_PHRASE);
  bind<[string], DestroyResult>("destroy:confirm", async (typedPhrase) => {
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
    defaultPath: `antistalker-export-${Date.now()}.json`,
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
