/**
 * AES-256-GCM field-level encryption for sensitive database columns.
 *
 * Encrypted fields are stored as text in the format:
 *   enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * The enc:v1: prefix enables transparent migration: decryptField() returns
 * existing plaintext values unchanged so old rows remain readable immediately
 * after the migration, until they are next written with encrypted values.
 *
 * Requires ENCRYPTION_KEY env var — a 64-character hex string (32 bytes).
 * Generate one:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Encrypted columns in this project:
 *   documents.content_text          — extracted document text (contracts, financials, etc.)
 *   users.google_access_token       — OAuth access credential
 *   users.google_refresh_token      — OAuth refresh credential (long-lived)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;  // 96-bit IV — standard for GCM
const PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const hex = process.env['ENCRYPTION_KEY'];
  if (!hex) {
    throw new Error(
      'ENCRYPTION_KEY is not set.\n' +
      "Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
      'Then add ENCRYPTION_KEY=<value> to your .env file.',
    );
  }
  if (hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
  }
  return Buffer.from(hex, 'hex');
}

/** Returns true if the value was produced by encryptField. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypts a UTF-8 string with AES-256-GCM.
 * Returns: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a value produced by encryptField.
 * If the value lacks the enc:v1: prefix (i.e. plaintext from before encryption
 * was enabled), returns it unchanged — transparent migration path.
 */
export function decryptField(value: string): string {
  if (!isEncrypted(value)) return value;

  const rest = value.slice(PREFIX.length);
  const parts = rest.split(':');
  if (parts.length !== 3) throw new Error('decryptField: invalid ciphertext format');

  const [ivHex, tagHex, ctHex] = parts as [string, string, string];
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ctHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Encrypt a nullable string. Returns null if input is null/undefined. */
export function encryptNullable(value: string | null | undefined): string | null {
  return value == null ? null : encryptField(value);
}

/** Decrypt a nullable string. Returns null if input is null/undefined. */
export function decryptNullable(value: string | null | undefined): string | null {
  return value == null ? null : decryptField(value);
}
