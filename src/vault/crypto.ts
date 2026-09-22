import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Vault encryption. The passphrase here must be independent of the OS
 * login: the threat model is an adversary who already knows the device
 * password, so unlocking the vault has to require a separate secret.
 *
 * This is a working baseline, not the fully hardened version: key
 * derivation and authenticated encryption are real and sound (scrypt +
 * AES-256-GCM, both built into Node, no native dependency), but in-memory
 * key handling, inactivity auto-lock, and clipboard/temp-file hygiene are
 * still open — see TODOS.md, "Harden vault key management".
 *
 * This encrypts sensitive field values (message text, raw payloads,
 * credential secrets), not the whole SQLite file. Row counts, timestamps,
 * senders and thread structure are visible to anyone who can open the
 * database file, even without the passphrase — only the content is
 * protected. Full-file encryption (e.g. via SQLCipher) would hide that
 * metadata too, at the cost of a native SQLite build; deliberately not
 * chosen here given how that build went earlier in this project.
 */
export interface VaultCrypto {
  unlock(passphrase: string): Promise<VaultKey>;
  lock(): Promise<void>;
}

export interface VaultKey {
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer): Buffer;
}

// scrypt cost parameters per the OWASP password storage cheat sheet's
// scrypt guidance (N=2^17, r=8, p=1). This runs once per vault unlock,
// not per request, so the ~1s cost on typical hardware is an acceptable
// trade for the brute-force resistance it buys.
const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32; // AES-256
// scrypt's memory use is roughly 128 * N * r bytes (~128MB at these
// parameters); Node's default maxmem (32MB) is well under that and would
// throw, so it has to be raised explicitly.
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

const SALT_LENGTH = 16;
const GCM_IV_LENGTH = 12;
const GCM_AUTH_TAG_LENGTH = 16;

/** A fixed plaintext encrypted under the vault key at creation time, purely so a later unlock attempt has something to verify a passphrase against. */
const CANARY_PLAINTEXT = Buffer.from("antistalker-vault-canary-v1", "utf8");

export interface VaultMetadata {
  version: 1;
  /** hex-encoded scrypt salt. Not secret — salts never are — so it's fine for this to sit in a plaintext metadata file. */
  salt: string;
  /** hex-encoded iv+authTag+ciphertext of CANARY_PLAINTEXT under the vault key. */
  canary: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

function encryptWithKey(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Throws if `key` is wrong or `blob` has been tampered with — GCM's authenticated decryption can't tell those apart, deliberately, see unlock() below. */
function decryptWithKey(key: Buffer, blob: Buffer): Buffer {
  const iv = blob.subarray(0, GCM_IV_LENGTH);
  const authTag = blob.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(GCM_IV_LENGTH + GCM_AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Generates a fresh salt and canary for a brand-new vault. Call once, at vault creation, and persist the result — there is no way to recover it if lost. */
export function createVaultMetadata(passphrase: string): VaultMetadata {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  return {
    version: 1,
    salt: salt.toString("hex"),
    canary: encryptWithKey(key, CANARY_PLAINTEXT).toString("hex"),
  };
}

class ScryptGcmVaultKey implements VaultKey {
  constructor(private readonly key: Buffer) {}

  encrypt(plaintext: Buffer): Buffer {
    return encryptWithKey(this.key, plaintext);
  }

  decrypt(ciphertext: Buffer): Buffer {
    return decryptWithKey(this.key, ciphertext);
  }
}

/**
 * The one error unlock() ever throws. A wrong passphrase and a corrupted
 * (bit-flipped) canary blob both surface as exactly this, through exactly
 * the same code path — both run the same scrypt derivation and the same
 * decrypt-and-catch, so neither the message nor the timing gives away
 * which one happened. This does NOT extend to every possible corruption:
 * a vault.meta.json file that's missing or isn't valid JSON fails earlier,
 * before key derivation even starts, with a distinguishable error — see
 * openVaultMetadata in vault.ts.
 */
const UNLOCK_FAILED_MESSAGE = "failed to unlock vault: wrong passphrase or corrupted vault data";

export class ScryptGcmVaultCrypto implements VaultCrypto {
  private key: VaultKey | undefined;

  constructor(private readonly metadata: VaultMetadata) {}

  async unlock(passphrase: string): Promise<VaultKey> {
    const salt = Buffer.from(this.metadata.salt, "hex");
    const derived = deriveKey(passphrase, salt);
    try {
      decryptWithKey(derived, Buffer.from(this.metadata.canary, "hex"));
    } catch {
      throw new Error(UNLOCK_FAILED_MESSAGE);
    }
    const key = new ScryptGcmVaultKey(derived);
    this.key = key;
    return key;
  }

  async lock(): Promise<void> {
    this.key = undefined;
  }

  /** For code that needs the current key without re-running unlock — e.g. a background ingest job started right after the user unlocked. Undefined if locked. */
  currentKey(): VaultKey | undefined {
    return this.key;
  }
}
