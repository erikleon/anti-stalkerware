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
import { compareWithKnownAccounts } from "../osint/known-accounts";
import { accountMatchesIdentifier, type KnownAccountKind, type StoredKnownAccount } from "../vault/known-accounts";
import type { VaultStore } from "../vault/store";
import { DESTROY_CONFIRMATION_PHRASE, DESTROY_DISCLOSURE_TEXT, confirmationMatches, destroyVault } from "../vault/destroy";
import type { Message, SourceKind } from "../types/message";
import * as onboarding from "./onboarding";
import { readInstagramBlocked } from "../ingest/instagram/blocked";
import { expandHome } from "./paths";
import { localTimeZone, resolveLocalDateTime, type LocalTimeResolution } from "../time/local-time";
import type { ScoringService, ScoringStatus } from "./scoring";
import type { IncidentEntry } from "../vault/incident-log";
import type {
  CandidateInput,
  DestroyResult,
  ExportHistoryEntry,
  ExportResult,
  HotkeyStatus,
  ImapConnectionInput,
  KnownAccountImportResult,
  NewIncidentInput,
  OsintSenderEligibility,
  RankedLead,
  Settings,
  SourceStatus,
  StoredBoundary,
  StoredTaggedPhrase,
  SweepResponse,
  SyncResult,
  UnlockResult,
} from "./api";

const SOURCE_LABELS: Array<{ source: SourceStatus["source"]; label: string }> = [
  { source: "imessage", label: "iMessage" },
  { source: "android-sms", label: "Android SMS export" },
  { source: "imap", label: "Email (IMAP)" },
  { source: "instagram", label: "Instagram export" },
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
export function registerHandlers(
  session: VaultSession,
  settings: SettingsStore,
  mainWindow: BrowserWindow,
  hotkeyStatus: HotkeyStatus,
  scoring: ScoringService,
): void {
  /** Runs an import, then scores what it added in the background. The import result never waits on the model. */
  async function importThenScore(run: () => Promise<SyncResult>): Promise<SyncResult> {
    const result = await run();
    void scoring.scoreVault();
    return result;
  }

  // Not vault-gated — the Support screen reads this from the lock screen
  // too, before any passphrase, same as its other content.
  bind<[], HotkeyStatus>(session, "support:hotkeyStatus", async () => hotkeyStatus);

  bind<[], boolean>(session, "vault:exists", async () => session.exists());
  bind<[string], UnlockResult>(session, "vault:initialize", async (passphrase) => ({ ok: await session.initialize(passphrase) }));
  bind<[string], UnlockResult>(session, "vault:unlock", async (passphrase) => {
    const ok = await session.unlock(passphrase);
    // Scores anything the current model hasn't: a vault from before the
    // model shipped, or everything after a model change.
    if (ok) void scoring.scoreVault();
    return { ok };
  });
  bind<[], ScoringStatus>(session, "scoring:status", async () => scoring.status());
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

  // Same gate as checkCandidate: comparing a sender against the user's
  // known accounts is still OSINT. Only threads whose sender is one of the
  // known accounts are loaded as writing baselines, not the whole vault.
  bindGated<[string], RankedLead[]>("osint:compareKnownAccounts", (sender) => sender, session, async (sender) => {
    const vault = requireVault(session);
    const knownAccounts = vault.knownAccounts.list();
    const senderMessages = await messagesFromSender(vault.store, sender);
    const baselineSenders = (await vault.store.listThreads())
      .map((t) => t.sender)
      .filter((s, i, all) => all.indexOf(s) === i && s !== sender && knownAccounts.some((a) => accountMatchesIdentifier(a, s)));
    const messagesBySender = new Map<string, Message[]>();
    for (const baselineSender of baselineSenders) {
      messagesBySender.set(baselineSender, await messagesFromSender(vault.store, baselineSender));
    }
    return rankCandidates(compareWithKnownAccounts(knownAccounts, sender, senderMessages, messagesBySender));
  });

  // The user's own list, not OSINT output — not gated. Adding an account
  // here looks nothing up; it only records what the user already knows.
  bind<[], StoredKnownAccount[]>(session, "knownAccounts:list", async () => requireVault(session).knownAccounts.list());
  bind<[string, KnownAccountKind, string], StoredKnownAccount>(session, "knownAccounts:add", async (personLabel, kind, value) =>
    requireVault(session).knownAccounts.add({ personLabel, kind, value, origin: "manual" }),
  );
  bind<[string, string], void>(session, "knownAccounts:setPersonLabel", async (id, personLabel) =>
    requireVault(session).knownAccounts.setPersonLabel(id, personLabel),
  );
  bind<[string], void>(session, "knownAccounts:remove", async (id) => requireVault(session).knownAccounts.remove(id));
  bind<[], KnownAccountImportResult>(session, "knownAccounts:importMacosBlocklist", async () =>
    onboarding.importMacosBlocklist(requireVault(session).knownAccounts),
  );

  bind<[string, "earlier" | "later" | undefined], LocalTimeResolution>(session, "incidentLog:resolveTime", async (local, choice) =>
    resolveLocalDateTime(local, localTimeZone(), choice),
  );
  bind<[], IncidentEntry[]>(session, "incidentLog:list", async () => requireVault(session).incidentLog.list());
  bind<[NewIncidentInput], IncidentEntry>(session, "incidentLog:add", async (input) => {
    checkIncidentSize(input.html, input.text);
    const time = resolveLocalDateTime(input.occurredLocal, localTimeZone(), input.choice);
    if (time.status !== "ok") throw new Error(INCIDENT_TIME_ERRORS[time.status]);
    return requireVault(session).incidentLog.add({
      occurredAt: time.instant,
      occurredLocal: time.zoned,
      ...(input.involving ? { involving: input.involving } : {}),
      html: input.html,
      text: input.text,
    });
  });
  bind<[string, string, string], IncidentEntry>(session, "incidentLog:revise", async (id, html, text) => {
    checkIncidentSize(html, text);
    return requireVault(session).incidentLog.revise(id, html, text);
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
  // Every sweep is marked against this Mac's block list and the known
  // accounts, so blocked senders show up first in the picker.
  async function annotated(rows: Parameters<typeof onboarding.annotateSweep>[0], extraBlocked: onboarding.BlockedEntry[] = []): Promise<SweepResponse> {
    const { summary, entries } = await onboarding.loadBlocklist();
    const macBlocked = entries.map((entry) => ({ ...entry, on: "macos" as const }));
    return onboarding.annotateSweep(rows, requireVault(session).knownAccounts, [...macBlocked, ...extraBlocked], summary);
  }
  bind<[string], SweepResponse>(session, "onboarding:sweepImessage", async (dbPath) => annotated(await onboarding.sweepImessage(dbPath)));
  bind<[string], SweepResponse>(session, "onboarding:sweepAndroidSms", async (exportFilePath) =>
    annotated(await onboarding.sweepAndroidSms(exportFilePath)),
  );
  bind<[ImapConnectionInput], SweepResponse>(session, "onboarding:sweepImap", async (connection) => annotated(await onboarding.sweepImap(connection)));
  bind<[string], SweepResponse>(session, "onboarding:sweepInstagram", async (exportDir) => {
    const rows = await onboarding.sweepInstagram(exportDir);
    const igBlocked = await readInstagramBlocked(expandHome(exportDir));
    const response = await annotated(
      rows,
      igBlocked.usernames.map((value) => ({ kind: "username" as const, value, on: "instagram" as const })),
    );
    return { ...response, instagramBlocked: { count: igBlocked.usernames.length, skipped: igBlocked.skipped } };
  });
  bind<[string, string[]], SyncResult>(session, "onboarding:connectInstagram", async (exportDir, selected) =>
    importThenScore(() => onboarding.connectInstagram(requireVault(session), exportDir, selected)),
  );
  bind<[string], { added: number; alreadyKnown: number; skipped: number }>(session, "onboarding:importInstagramBlocked", async (exportDir) =>
    onboarding.importInstagramBlocked(requireVault(session).knownAccounts, exportDir),
  );
  bind<[], string | undefined>(session, "onboarding:pickFolder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    return canceled ? undefined : filePaths[0];
  });
  bind<[string[]], { added: number; alreadyKnown: number }>(session, "onboarding:saveBlockedAsKnown", async (identifiers) =>
    onboarding.saveBlockedAsKnown(requireVault(session).knownAccounts, identifiers),
  );
  bind<[string, string[]], SyncResult>(session, "onboarding:connectImessage", async (dbPath, selected) =>
    importThenScore(() => onboarding.connectImessage(requireVault(session), dbPath, selected)),
  );
  bind<[string, string[]], SyncResult>(session, "onboarding:connectAndroidSms", async (exportFilePath, selected) =>
    importThenScore(() => onboarding.connectAndroidSms(requireVault(session), exportFilePath, selected)),
  );
  bind<[ImapConnectionInput, string[]], SyncResult>(session, "onboarding:connectImap", async (connection, selected) =>
    importThenScore(() => onboarding.connectImapSource(requireVault(session), connection, selected)),
  );
  bind<[SourceKind], SyncResult>(session, "onboarding:syncNow", async (source) =>
    importThenScore(() => onboarding.syncNow(requireVault(session), source)),
  );
  bind<[SourceKind], void>(session, "onboarding:disconnect", async (source) => onboarding.disconnect(requireVault(session), source));

  bind<[], StoredBoundary[]>(session, "userContext:listBoundaries", async () => requireVault(session).userContext.listBoundaries());
  bind<[string, string, string | undefined], StoredBoundary>(session, "userContext:addBoundary", async (description, setOn, appliesToSender) =>
    requireVault(session).userContext.addBoundaryOnDate(description, setOn, localTimeZone(), appliesToSender),
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

/** The renderer resolves the time first and asks the user; these only show if that step was skipped. */
const INCIDENT_TIME_ERRORS = {
  ambiguous: "That time happened twice that night, when the clocks went back. Choose which one.",
  nonexistent: "That time didn't happen that night: the clocks skipped forward over it. Choose another time.",
  invalid: "That isn't a date and time the app can read.",
} as const;

// Far more than any written account needs; stops a runaway paste from
// filling the vault.
const MAX_INCIDENT_HTML_LENGTH = 500_000;

function checkIncidentSize(html: string, text: string): void {
  if (html.length > MAX_INCIDENT_HTML_LENGTH || text.length > MAX_INCIDENT_HTML_LENGTH) {
    throw new Error("That entry is too long to save. Split it into more than one entry.");
  }
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

  const incidents = vault.incidentLog.list();
  const payload = buildExportPayload(messages, localTimeZone(), incidents);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  await vault.integrityLog.append({
    kind: "export",
    recordHashes: messages.map((m) => m.rawRecordHash),
    occurredAt: new Date(),
  });

  return { filePath, messageCount: messages.length, incidentCount: incidents.length };
}
