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

export type { Bucket, TriageRow, StoredBoundary, StoredTaggedPhrase, CandidateInput, OsintSignal };

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
  source: "imessage" | "android-sms" | "imap";
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
    /** setAt is a real, user-picked date, not "now" — a boundary is often logged after the fact. */
    addBoundary(description: string, setAt: Date, appliesToSender?: string): Promise<StoredBoundary>;
    removeBoundary(id: string): Promise<void>;
    listTaggedPhrases(): Promise<StoredTaggedPhrase[]>;
    addTaggedPhrase(phrase: string, note: string): Promise<StoredTaggedPhrase>;
    removeTaggedPhrase(id: string): Promise<void>;
  };
  onboarding: {
    /** Opens a native file picker; undefined if the user canceled. */
    pickFile(): Promise<string | undefined>;
    sweepImessage(dbPath: string): Promise<MetadataSweepResult[]>;
    sweepAndroidSms(exportFilePath: string): Promise<MetadataSweepResult[]>;
    sweepImap(connection: ImapConnectionInput): Promise<MetadataSweepResult[]>;
    /** Saves the config, stores the credential (imap only), and runs the first ingest — one round trip instead of connect-then-sync. */
    connectImessage(dbPath: string, selectedIdentifiers: string[]): Promise<SyncResult>;
    connectAndroidSms(exportFilePath: string, selectedIdentifiers: string[]): Promise<SyncResult>;
    connectImap(connection: ImapConnectionInput, selectedIdentifiers: string[]): Promise<SyncResult>;
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
