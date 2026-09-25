import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createVaultMetadata, ScryptGcmVaultCrypto, type VaultKey, type VaultMetadata } from "./crypto";
import { SqliteVaultStore } from "./sqlite-store";
import { SqliteCredentialStore } from "./credentials";
import { SqliteIntegrityLog } from "./integrity";
import { TriageStateStore } from "./triage-state";
import { SourceConfigStore } from "./source-config";
import { UserContextStore } from "./user-context";
import { KnownAccountStore } from "./known-accounts";
import { IncidentLogStore } from "./incident-log";
import { localTimeZone } from "../time/local-time";

const METADATA_FILENAME = "vault.meta.json";
const DB_FILENAME = "vault.db";

/** A distinguishable failure from unlock's — this fails before key derivation even starts, so it can't be timing- or message-matched to a wrong passphrase. See crypto.ts's UNLOCK_FAILED_MESSAGE doc comment for why that's an accepted limit, not an oversight. */
export class VaultMetadataError extends Error {}

async function readVaultMetadata(vaultDir: string): Promise<VaultMetadata> {
  const path = join(vaultDir, METADATA_FILENAME);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new VaultMetadataError(`vault metadata file is missing: ${path}`);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<VaultMetadata>;
    if (typeof parsed.salt !== "string" || typeof parsed.canary !== "string" || parsed.version !== 1) {
      throw new Error("missing required fields");
    }
    return parsed as VaultMetadata;
  } catch {
    throw new VaultMetadataError(`vault metadata file is corrupted or not valid JSON: ${path}`);
  }
}

export interface Vault {
  store: SqliteVaultStore;
  credentials: SqliteCredentialStore;
  integrityLog: SqliteIntegrityLog;
  triageState: TriageStateStore;
  sourceConfig: SourceConfigStore;
  userContext: UserContextStore;
  knownAccounts: KnownAccountStore;
  incidentLog: IncidentLogStore;
  key: VaultKey;
  close(): void;
}

/** True if a vault already exists at this directory (has metadata written). */
export function vaultExists(vaultDir: string): boolean {
  return existsSync(join(vaultDir, METADATA_FILENAME));
}

/** First-run setup: generates fresh salt/canary metadata and writes it to disk. Does not create the database — that happens on first openVault, same as any later run. */
export async function initializeVault(vaultDir: string, passphrase: string): Promise<void> {
  if (vaultExists(vaultDir)) {
    throw new Error(`a vault already exists at ${vaultDir} — refusing to overwrite its metadata`);
  }
  await mkdir(vaultDir, { recursive: true });
  const metadata = createVaultMetadata(passphrase);
  await writeFile(join(vaultDir, METADATA_FILENAME), JSON.stringify(metadata, null, 2), "utf8");
}

/**
 * Opens an existing vault: verifies the passphrase against the stored
 * canary, then wires the store, credential store and integrity log to the
 * same database and key. Call initializeVault first if this is the vault's
 * first run.
 */
export async function openVault(vaultDir: string, passphrase: string): Promise<Vault> {
  const metadata = await readVaultMetadata(vaultDir);
  const crypto = new ScryptGcmVaultCrypto(metadata);
  const key = await crypto.unlock(passphrase);

  const db = new Database(join(vaultDir, DB_FILENAME));

  const store = new SqliteVaultStore(db, key);
  const credentials = new SqliteCredentialStore(db, key);
  const integrityLog = new SqliteIntegrityLog(db);
  const triageState = new TriageStateStore(db);
  const sourceConfig = new SourceConfigStore(db);
  const userContext = new UserContextStore(db, localTimeZone());
  const knownAccounts = new KnownAccountStore(db);
  const incidentLog = new IncidentLogStore(db, key);

  return {
    store,
    credentials,
    integrityLog,
    triageState,
    sourceConfig,
    userContext,
    knownAccounts,
    incidentLog,
    key,
    close() {
      // store, credentials and integrityLog all share this one connection —
      // closing it here is enough; there's nothing separate to close on them.
      db.close();
    },
  };
}
