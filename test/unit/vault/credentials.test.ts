import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { removeTestDir } from "../../helpers/tmp-dir";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteCredentialStore } from "../../../src/vault/credentials";
import { createVaultMetadata, ScryptGcmVaultCrypto, type VaultKey } from "../../../src/vault/crypto";

describe("SqliteCredentialStore", () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;
  let key: VaultKey;
  let store: SqliteCredentialStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "docket-credentials-test-"));
    dbPath = join(dir, "vault.db");
    db = new Database(dbPath);
    const metadata = createVaultMetadata("pass");
    key = await new ScryptGcmVaultCrypto(metadata).unlock("pass");
    store = new SqliteCredentialStore(db, key);
  });

  afterEach(() => {
    db.close();
    removeTestDir(dir);
  });

  it("round-trips a saved credential", async () => {
    await store.save({ account: "victim@gmail.com", secret: "app-specific-password-123", kind: "app-password" });
    const fetched = await store.get("victim@gmail.com");
    expect(fetched?.secret).toBe("app-specific-password-123");
    expect(fetched?.kind).toBe("app-password");
  });

  it("returns undefined for an account with no stored credential", async () => {
    expect(await store.get("nobody@example.com")).toBeUndefined();
  });

  it("overwrites the previous credential for the same account (e.g. a refreshed OAuth token)", async () => {
    await store.save({ account: "victim@gmail.com", secret: "old-token", kind: "oauth-refresh-token" });
    await store.save({ account: "victim@gmail.com", secret: "new-token", kind: "oauth-refresh-token" });

    const fetched = await store.get("victim@gmail.com");
    expect(fetched?.secret).toBe("new-token");

    const count = db.prepare("SELECT COUNT(*) as c FROM credentials").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("remove deletes a stored credential (disconnecting a source)", async () => {
    await store.save({ account: "victim@gmail.com", secret: "app-specific-password-123", kind: "app-password" });
    await store.remove("victim@gmail.com");
    expect(await store.get("victim@gmail.com")).toBeUndefined();
  });

  it("never stores the credential secret as plaintext on disk", async () => {
    await store.save({ account: "victim@gmail.com", secret: "SECRET_CREDENTIAL_MARKER", kind: "app-password" });
    db.close();
    const fileBytes = readFileSync(dbPath);
    expect(fileBytes.includes("SECRET_CREDENTIAL_MARKER")).toBe(false);
    db = new Database(dbPath); // reopen so afterEach's close() doesn't double-close
  });
});
