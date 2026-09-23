/**
 * The renderer-facing API surface, exposed at window.antistalker by
 * preload.ts via contextBridge. Plain data in, plain data out — the
 * renderer never touches a VaultStore, a Database handle, or anything
 * else that isn't safe to hand across the context-isolation boundary.
 *
 * Kept as one file so preload.ts (which implements this) and the renderer
 * (which only ever imports it with `import type`, so none of this ever
 * actually runs in the browser context) can't drift out of sync.
 */
import type { Bucket, TriageRow } from "../triage/view";
import type { Message } from "../types/message";

export type { Bucket, TriageRow };

export interface UnlockResult {
  /** Never distinguishes "wrong passphrase" from "corrupted vault" — see crypto.ts. */
  ok: boolean;
}

export interface Settings {
  toastOnTriageAction: boolean;
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
}

export interface DestroyResult {
  removed: boolean;
  filesRemoved: string[];
}

export interface ExportResult {
  filePath: string;
  messageCount: number;
}

export interface AntistalkerApi {
  vault: {
    exists(): Promise<boolean>;
    initialize(passphrase: string): Promise<UnlockResult>;
    unlock(passphrase: string): Promise<UnlockResult>;
    lock(): Promise<void>;
    isUnlocked(): Promise<boolean>;
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
    rank(sender: string): Promise<RankedLead[]>;
  };
  vaultExport: {
    listAll(): Promise<Message[]>;
    disclosureText(): Promise<string>;
    exportToFile(): Promise<ExportResult | undefined>;
  };
  settings: {
    get(): Promise<Settings>;
    setToastOnTriageAction(value: boolean): Promise<void>;
    listSources(): Promise<SourceStatus[]>;
  };
  destroy: {
    disclosureText(): Promise<string>;
    confirmationPhrase(): Promise<string>;
    confirm(typedPhrase: string): Promise<DestroyResult>;
  };
}
