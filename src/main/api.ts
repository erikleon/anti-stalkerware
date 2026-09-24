/**
 * The renderer-facing API surface, exposed at window.docket by
 * preload.ts via contextBridge. Plain data in, plain data out — the
 * renderer never touches a VaultStore, a Database handle, or anything
 * else that isn't safe to hand across the context-isolation boundary.
 *
 * Kept as one file so preload.ts (which implements this) and the renderer
 * (which only ever imports it with `import type`, so none of this ever
 * actually runs in the browser context) can't drift out of sync.
 */
import type { Bucket, TriageRow } from "../triage/view";
import type { Message, SourceKind } from "../types/message";
import type { MetadataSweepResult } from "../ingest/adapter";
import type { StoredBoundary, StoredTaggedPhrase } from "../vault/user-context";
import type { CandidateInput } from "../osint/candidate-input";
import type { OsintSignal } from "../osint/graph";
import type { KnownAccountKind, StoredKnownAccount } from "../vault/known-accounts";

export type { Bucket, TriageRow, StoredBoundary, StoredTaggedPhrase, CandidateInput, OsintSignal, KnownAccountKind, StoredKnownAccount };

export interface UnlockResult {
  /** Never distinguishes "wrong passphrase" from "corrupted vault" — see crypto.ts. */
  ok: boolean;
}

export interface HotkeyStatus {
  registered: boolean;
  /** Human-readable, platform-correct combo (e.g. "⌘+Shift+Esc" or "Ctrl+Shift+Alt+H") — computed in main/index.ts, which is the one place that actually knows process.platform and which accelerator string it registered. */
  label: string;
}

export interface Settings {
  toastOnTriageAction: boolean;
  /** Minutes of inactivity before the vault auto-locks. 0 disables it. */
  autoLockMinutes: number;
}

export interface SourceStatus {
  source: SourceKind;
  label: string;
  connected: boolean;
}

export interface OsintSenderEligibility {
  sender: string;
  eligible: boolean;
}

export interface RankedLead {
  candidateId: string;
  score: number;
  supportingSignalCount: number;
  /** Never a bare verdict — the actual signals behind the score, so a result always shows its own reasoning. */
  signals: OsintSignal[];
}

export interface DestroyResult {
  removed: boolean;
  filesRemoved: string[];
}

export interface ExportResult {
  filePath: string;
  messageCount: number;
}

export interface ExportHistoryEntry {
  occurredAt: Date;
  recordCount: number;
}

/** Non-secret IMAP connection fields the onboarding form collects, plus the app password itself — the only field handlers.ts strips out before persisting to SourceConfigStore (it goes to CredentialStore instead). */
export interface ImapConnectionInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  appPassword: string;
  mailbox: string;
}

export interface SyncResult {
  appended: number;
  quarantined: number;
}

/** What onboarding learned from this Mac's block list — see ingest/blocklist/macos-blocklist.ts. */
export interface BlocklistSummary {
  status: "ok" | "not-found" | "unsupported-platform" | "error";
  blockedCount: number;
  /** Block list entries that weren't a phone number or email, so couldn't be read. */
  skipped: number;
  error?: string;
}

export interface SweepRow extends MetadataSweepResult {
  /** Set when this sender is on a block list: this Mac's (Messages/FaceTime), or the Instagram export's own. */
  blockedOn?: "macos" | "instagram";
  /** Set when this sender is already a known account; the person label the user gave it. */
  knownAccountLabel?: string;
}

export interface SweepResponse {
  rows: SweepRow[];
  blocklist: BlocklistSummary;
  /** Only for an Instagram export: how many accounts its own block list holds. */
  instagramBlocked?: { count: number; skipped: number };
}

export interface KnownAccountImportResult extends BlocklistSummary {
  added: number;
  alreadyKnown: number;
}

export interface DocketApi {
  vault: {
    exists(): Promise<boolean>;
    initialize(passphrase: string): Promise<UnlockResult>;
    unlock(passphrase: string): Promise<UnlockResult>;
    lock(): Promise<void>;
    isUnlocked(): Promise<boolean>;
    /** Fires when the main process auto-locks the vault after inactivity — the one push (not request/response) channel in this API, since the renderer can't poll for something main decides on its own timer. Returns an unsubscribe function. */
    onLocked(callback: () => void): () => void;
  };
  support: {
    /** Whether the panic-hide hotkey actually got registered with the OS at launch, and which combo — see main/index.ts's registerPanicHotkey. Not vault-gated. */
    hotkeyStatus(): Promise<HotkeyStatus>;
  };
  triage: {
    listRows(bucket: Bucket): Promise<TriageRow[]>;
    counts(): Promise<Record<Bucket, number>>;
    listMessages(threadId: string): Promise<Message[]>;
    setReviewed(messageId: string, reviewed: boolean): Promise<void>;
    setHidden(messageId: string, hidden: boolean): Promise<void>;
  };
  osint: {
    eligibleSenders(): Promise<OsintSenderEligibility[]>;
    /** Verify-mode only: checks one candidate the user already named against vault-held signals for this sender. Cannot discover who someone is from a bare identifier — see DESIGN.md's OSINT collector decision. */
    checkCandidate(sender: string, candidate: CandidateInput): Promise<RankedLead>;
    /** Compares this sender against every person in the known-accounts list, one lead per person, best first. Same gate and same verify-mode limits as checkCandidate. */
    compareKnownAccounts(sender: string): Promise<RankedLead[]>;
  };
  knownAccounts: {
    list(): Promise<StoredKnownAccount[]>;
    add(personLabel: string, kind: KnownAccountKind, value: string): Promise<StoredKnownAccount>;
    setPersonLabel(id: string, personLabel: string): Promise<void>;
    remove(id: string): Promise<void>;
    /** Adds every entry on this Mac's block list, each as its own person until relabeled. */
    importMacosBlocklist(): Promise<KnownAccountImportResult>;
  };
  vaultExport: {
    listAll(): Promise<Message[]>;
    disclosureText(): Promise<string>;
    exportToFile(): Promise<ExportResult | undefined>;
    history(): Promise<ExportHistoryEntry[]>;
  };
  settings: {
    get(): Promise<Settings>;
    setToastOnTriageAction(value: boolean): Promise<void>;
    setAutoLockMinutes(value: number): Promise<void>;
    listSources(): Promise<SourceStatus[]>;
  };
  userContext: {
    listBoundaries(): Promise<StoredBoundary[]>;
    /** setOn is a real, user-picked calendar date ("YYYY-MM-DD"), not "now" — a boundary is often logged after the fact. The boundary starts at the beginning of that day in this machine's time zone. */
    addBoundary(description: string, setOn: string, appliesToSender?: string): Promise<StoredBoundary>;
    removeBoundary(id: string): Promise<void>;
    listTaggedPhrases(): Promise<StoredTaggedPhrase[]>;
    addTaggedPhrase(phrase: string, note: string): Promise<StoredTaggedPhrase>;
    removeTaggedPhrase(id: string): Promise<void>;
  };
  onboarding: {
    /** Opens a native file picker; undefined if the user canceled. */
    pickFile(): Promise<string | undefined>;
    sweepImessage(dbPath: string): Promise<SweepResponse>;
    sweepAndroidSms(exportFilePath: string): Promise<SweepResponse>;
    sweepImap(connection: ImapConnectionInput): Promise<SweepResponse>;
    sweepInstagram(exportDir: string): Promise<SweepResponse>;
    /** Opens a native folder picker; undefined if the user canceled. */
    pickFolder(): Promise<string | undefined>;
    /** Saves the chosen senders that are on this Mac's block list as known accounts. Senders not on the block list are ignored. */
    saveBlockedAsKnown(identifiers: string[]): Promise<{ added: number; alreadyKnown: number }>;
    /** Saves the config, stores the credential (imap only), and runs the first ingest — one round trip instead of connect-then-sync. */
    connectImessage(dbPath: string, selectedIdentifiers: string[]): Promise<SyncResult>;
    connectAndroidSms(exportFilePath: string, selectedIdentifiers: string[]): Promise<SyncResult>;
    connectImap(connection: ImapConnectionInput, selectedIdentifiers: string[]): Promise<SyncResult>;
    connectInstagram(exportDir: string, selectedIdentifiers: string[]): Promise<SyncResult>;
    /** Saves every account on the Instagram export's block list as a known account, each as its own person. */
    importInstagramBlocked(exportDir: string): Promise<{ added: number; alreadyKnown: number; skipped: number }>;
    /** Re-runs ingest for an already-connected source using its saved config. */
    syncNow(source: SourceKind): Promise<SyncResult>;
    disconnect(source: SourceKind): Promise<void>;
  };
  destroy: {
    disclosureText(): Promise<string>;
    confirmationPhrase(): Promise<string>;
    confirm(typedPhrase: string): Promise<DestroyResult>;
  };
}
