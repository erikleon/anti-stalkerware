// A standalone mirror of src/main/api.ts's DocketApi, not an import of
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
    signalDetails: string[];
  }

  type MessageProvenance = "live" | "edit-history" | "wal-recovered";
  type SourceKind = "imessage" | "android-sms" | "imap" | "instagram";

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

  interface HotkeyStatus {
    registered: boolean;
    label: string;
  }

  interface Settings {
    toastOnTriageAction: boolean;
    autoLockMinutes: number;
  }

  interface SourceStatus {
    source: SourceKind;
    label: string;
    connected: boolean;
  }

  interface StoredBoundary {
    id: string;
    setAt: Date;
    setOn?: string;
    timeZone?: string;
    description: string;
    appliesToSender?: string;
  }

  interface StoredTaggedPhrase {
    id: string;
    phrase: string;
    note: string;
  }

  interface OsintSenderEligibility {
    sender: string;
    eligible: boolean;
  }

  type OsintSignalKind = "username-reuse" | "email-reuse" | "phone-reuse" | "profile-photo-match" | "writing-style-match";

  interface OsintSignal {
    kind: OsintSignalKind;
    candidateId: string;
    source: string;
    confidence: number;
  }

  interface RankedLead {
    candidateId: string;
    score: number;
    supportingSignalCount: number;
    signals: OsintSignal[];
  }

  interface CandidateInput {
    label: string;
    username?: string;
    email?: string;
    phone?: string;
    writingSample?: string;
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

  interface MetadataSweepResult {
    sender: string;
    messageCount: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    aliases?: string[];
  }

  interface ImapConnectionInput {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    appPassword: string;
    mailbox: string;
  }

  interface SyncResult {
    appended: number;
    quarantined: number;
  }

  interface BlocklistSummary {
    status: "ok" | "not-found" | "unsupported-platform" | "error";
    blockedCount: number;
    skipped: number;
    error?: string;
  }

  interface SweepRow extends MetadataSweepResult {
    blockedOn?: "macos" | "instagram";
    knownAccountLabel?: string;
  }

  interface SweepResponse {
    rows: SweepRow[];
    blocklist: BlocklistSummary;
    instagramBlocked?: { count: number; skipped: number };
  }

  type KnownAccountKind = "phone" | "email" | "username";
  type KnownAccountOrigin = "manual" | "macos-blocklist" | "instagram-blocklist";

  interface StoredKnownAccount {
    id: string;
    personLabel: string;
    kind: KnownAccountKind;
    value: string;
    origin: KnownAccountOrigin;
    addedAt: Date;
  }

  interface KnownAccountImportResult extends BlocklistSummary {
    added: number;
    alreadyKnown: number;
  }

  interface DocketApi {
    vault: {
      exists(): Promise<boolean>;
      initialize(passphrase: string): Promise<UnlockResult>;
      unlock(passphrase: string): Promise<UnlockResult>;
      lock(): Promise<void>;
      isUnlocked(): Promise<boolean>;
      onLocked(callback: () => void): () => void;
    };
    support: {
      hotkeyStatus(): Promise<HotkeyStatus>;
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
      checkCandidate(sender: string, candidate: CandidateInput): Promise<RankedLead>;
      compareKnownAccounts(sender: string): Promise<RankedLead[]>;
    };
    knownAccounts: {
      list(): Promise<StoredKnownAccount[]>;
      add(personLabel: string, kind: KnownAccountKind, value: string): Promise<StoredKnownAccount>;
      setPersonLabel(id: string, personLabel: string): Promise<void>;
      remove(id: string): Promise<void>;
      importMacosBlocklist(): Promise<KnownAccountImportResult>;
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
      setAutoLockMinutes(value: number): Promise<void>;
      listSources(): Promise<SourceStatus[]>;
    };
    userContext: {
      listBoundaries(): Promise<StoredBoundary[]>;
      addBoundary(description: string, setOn: string, appliesToSender?: string): Promise<StoredBoundary>;
      removeBoundary(id: string): Promise<void>;
      listTaggedPhrases(): Promise<StoredTaggedPhrase[]>;
      addTaggedPhrase(phrase: string, note: string): Promise<StoredTaggedPhrase>;
      removeTaggedPhrase(id: string): Promise<void>;
    };
    destroy: {
      disclosureText(): Promise<string>;
      confirmationPhrase(): Promise<string>;
      confirm(typedPhrase: string): Promise<DestroyResult>;
    };
    onboarding: {
      pickFile(): Promise<string | undefined>;
      sweepImessage(dbPath: string): Promise<SweepResponse>;
      sweepAndroidSms(exportFilePath: string): Promise<SweepResponse>;
      sweepImap(connection: ImapConnectionInput): Promise<SweepResponse>;
      sweepInstagram(exportDir: string): Promise<SweepResponse>;
      pickFolder(): Promise<string | undefined>;
      connectInstagram(exportDir: string, selectedIdentifiers: string[]): Promise<SyncResult>;
      importInstagramBlocked(exportDir: string): Promise<{ added: number; alreadyKnown: number; skipped: number }>;
      saveBlockedAsKnown(identifiers: string[]): Promise<{ added: number; alreadyKnown: number }>;
      connectImessage(dbPath: string, selectedIdentifiers: string[]): Promise<SyncResult>;
      connectAndroidSms(exportFilePath: string, selectedIdentifiers: string[]): Promise<SyncResult>;
      connectImap(connection: ImapConnectionInput, selectedIdentifiers: string[]): Promise<SyncResult>;
      syncNow(source: SourceKind): Promise<SyncResult>;
      disconnect(source: SourceKind): Promise<void>;
    };
  }

  interface Window {
    docket: DocketApi;
  }
}

export {};
