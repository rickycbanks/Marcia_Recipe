/**
 * AES-256-GCM encryption for the private OCR config envelope.
 *
 * Format (base64url): base64url(iv).base64url(ciphertext).base64url(tag)
 * Additional authenticated data (AAD) is the literal envelope version string.
 *
 * The PRIVATE_CONFIG_KEYRING env var holds one or more comma-separated
 * `keyId:base64url32bytekey` pairs. The FIRST key encrypts; ALL keys decrypt
 * (for rotation).  AUTH_SECRET is never used.
 *
 * Without a valid keyring the module exposes `isKeyringAvailable() === false`
 * and `encrypt()`/`decrypt()` throw actionable errors. Legacy Tesseract-only
 * deployments continue to work without any keyring.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = "v1";

/* -------------------------------- keyring -------------------------------- */

export interface KeyringEntry {
  id: string;
  key: Buffer;
}

let cachedKeyring: KeyringEntry[] | null = null;

function parseKeyring(raw: string | undefined): KeyringEntry[] {
  if (!raw) return [];
  const entries: KeyringEntry[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) continue;
    const id = trimmed.slice(0, colonIdx);
    const keyB64 = trimmed.slice(colonIdx + 1);
    try {
      const key = Buffer.from(keyB64, "base64url");
      if (key.byteLength !== KEY_BYTES) continue;
      entries.push({ id, key });
    } catch {
      continue;
    }
  }
  return entries;
}

function getKeyring(): KeyringEntry[] {
  if (cachedKeyring) return cachedKeyring;
  cachedKeyring = parseKeyring(process.env.PRIVATE_CONFIG_KEYRING);
  return cachedKeyring;
}

/** Test hook: re-read keyring on next access. */
export function resetKeyringCache(): void {
  cachedKeyring = null;
}

export function isKeyringAvailable(): boolean {
  return getKeyring().length > 0;
}

export function getEncryptKeyId(): string | null {
  const ring = getKeyring();
  return ring.length > 0 ? ring[0]!.id : null;
}

/* -------------------------------- encrypt -------------------------------- */

/**
 * Encrypt a plaintext string using the first keyring entry.
 * Returns the envelope string `v1.<iv>.<ciphertext>.<tag>` (all base64url).
 */
export function encrypt(plaintext: string): string {
  const ring = getKeyring();
  if (ring.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "PRIVATE_CONFIG_KEYRING is not configured. Cloud OCR credentials cannot be saved without an encryption key. " +
        "Set PRIVATE_CONFIG_KEYRING to a comma-separated list of keyId:base64url(32-byte-key) pairs.",
    );
  }
  const { key } = ring[0]!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(ENVELOPE_VERSION, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_VERSION}.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

/* -------------------------------- validate ------------------------------- */

/** Quick structural check (no decryption): returns true for a well-shaped envelope. */
export function isValidEnvelopeShape(envelope: string): boolean {
  const dotCount = [...envelope].filter((c) => c === ".").length;
  if (dotCount !== 3) return false;
  const [version, ivB64, ciphertextB64, tagB64] = envelope.split(".");
  if (version !== ENVELOPE_VERSION) return false;
  if (!ivB64 || !ciphertextB64 || !tagB64) return false;
  // Each segment must be valid base64url
  const b64urlRe = /^[A-Za-z0-9_-]+$/;
  return b64urlRe.test(ivB64) && b64urlRe.test(ciphertextB64) && b64urlRe.test(tagB64);
}

/* -------------------------------- decrypt -------------------------------- */

/**
 * Decrypt an envelope string produced by `encrypt()`. Tries every keyring
 * entry in order so rotated keys still work.
 */
export function decrypt(envelope: string): string {
  const ring = getKeyring();
  if (ring.length === 0) {
    throw new AppError("BAD_REQUEST", "PRIVATE_CONFIG_KEYRING is not configured; cannot decrypt OCR config.");
  }

  const dotCount = [...envelope].filter((c) => c === ".").length;
  if (dotCount !== 3) throw new Error("Malformed OCR config envelope");

  const [version, ivB64, ciphertextB64, tagB64] = envelope.split(".");
  if (version !== ENVELOPE_VERSION) throw new Error(`Unsupported OCR config envelope version: ${version}`);
  if (!ivB64 || !ciphertextB64 || !tagB64) throw new Error("Malformed OCR config envelope");

  const iv = Buffer.from(ivB64, "base64url");
  const ciphertext = Buffer.from(ciphertextB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const aad = Buffer.from(ENVELOPE_VERSION, "utf8");

  let lastError: Error | null = null;
  for (const { key } of ring) {
    try {
      const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString("utf8");
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw new Error(
    `OCR config envelope could not be decrypted. The encryption key may have been rotated. ` +
      `Ensure PRIVATE_CONFIG_KEYRING contains the key used to encrypt. (${lastError?.message ?? "unknown"})`,
  );
}
