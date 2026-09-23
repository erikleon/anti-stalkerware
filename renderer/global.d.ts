// A standalone mirror of src/main/api.ts's AntistalkerApi, not an import of
// it. Importing it directly pulls its whole dependency graph (triage/view,
// vault/store, types/message, better-sqlite3's types...) into the
// renderer's own compile, which targets a different module system and
// forbids emitting files outside its rootDir. The renderer only needs the
// wire shape, not the modules that produce it on the main-process side —
// same reasoning as depending on a REST API's documented response shape
// rather than the server's internal types.
//
// Keep this in sync with src/main/api.ts by hand; it's small on purpose.
declare global {
  type Bucket = "needs-review" | "reviewed" | "all";
  type ToxicityBand = "high" | "medium" | "none";

  interface TriageRow {
    threadId: string;
    sender: string;
    latestMessageId: string;
    latestText: string;
    latestSentAt: Date;
    messageCount: number;
    maxToxicityScore: number;
    crossesAbuseThreshold: boolean;
    reviewed: boolean;
    hidden: boolean;
    band: ToxicityBand;
  }

  type MessageProvenance = "live" | "edit-history" | "wal-recovered";
  type SourceKind = "imessage" | "android-sms" | "imap";

  interface WireMessage {
    id: string;
    rawRecordHash: string;
    source: SourceKind;
    threadId: string;
    sender: string;
    fromSelf: boolean;
    text: string;
    sentAt: Date;
    provenance: MessageProvenance;
    editHistory?: Array<{ text: string; editedAt: Date }>;
    retractedAt?: Date;
  }

  interface UnlockResult {
    ok: boolean;
  }

  interface Settings {
    toastOnTriageAction: boolean;
  }

  interface SourceStatus {
    source: SourceKind;
    label: string;
    connected: boolean;
  }

  interface OsintSenderEligibility {
    sender: string;
    eligible: boolean;
  }

  interface RankedLead {
    candidateId: string;
    score: number;
    supportingSignalCount: number;
  }

  interface DestroyResult {
    removed: boolean;
    filesRemoved: string[];
  }

  interface ExportResult {
    filePath: string;
    messageCount: number;
  }

  interface ExportHistoryEntry {
    occurredAt: Date;
    recordCount: number;
  }

  interface AntistalkerApi {
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
      listMessages(threadId: string): Promise<WireMessage[]>;
      setReviewed(messageId: string, reviewed: boolean): Promise<void>;
      setHidden(messageId: string, hidden: boolean): Promise<void>;
    };
    osint: {
      eligibleSenders(): Promise<OsintSenderEligibility[]>;
      rank(sender: string): Promise<RankedLead[]>;
    };
    vaultExport: {
      listAll(): Promise<WireMessage[]>;
      disclosureText(): Promise<string>;
      exportToFile(): Promise<ExportResult | undefined>;
      history(): Promise<ExportHistoryEntry[]>;
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

  interface Window {
    antistalker: AntistalkerApi;
  }
}

export {};
