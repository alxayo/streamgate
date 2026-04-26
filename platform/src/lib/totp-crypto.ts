// =========================================================================
// TOTP Secret Encryption (AES-256-GCM)
// =========================================================================
// Each admin user's TOTP secret (the shared secret between the server and their
// authenticator app) is encrypted before being stored in the database.
//
// Why encrypt? If the database is leaked, the attacker can't generate valid
// TOTP codes without also knowing ADMIN_SESSION_SECRET.
//
// Encryption scheme:
//   - Algorithm: AES-256-GCM (authenticated encryption — detects tampering)
//   - Key derivation: SHA-256("streamgate-totp-encryption:" + ADMIN_SESSION_SECRET)
//   - IV: 12 random bytes (unique per encryption, stored alongside ciphertext)
//   - Storage format: base64(iv):base64(ciphertext):base64(authTag)
//
// WARNING: If ADMIN_SESSION_SECRET changes, all stored TOTP secrets become
// unrecoverable. Users would need to re-setup 2FA via admin reset.
// =========================================================================

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Derives a 256-bit AES key from the admin session secret.
 * Uses SHA-256 with a fixed context prefix ("streamgate-totp-encryption:") so the
 * derived key is unique to TOTP encryption, even though ADMIN_SESSION_SECRET is
 * also used for session cookie encryption (iron-session uses it differently).
 */
function deriveKey(secret: string): Buffer {
  return createHash('sha256')
    .update(`streamgate-totp-encryption:${secret}`)
    .digest();
}

/**
 * Encrypts a TOTP secret using AES-256-GCM.
 * 
 * @param plaintext - The base32-encoded TOTP secret from the authenticator setup
 * @param adminSessionSecret - The ADMIN_SESSION_SECRET env var
 * @returns Encrypted string in format: base64(iv):base64(ciphertext):base64(authTag)
 *
 * The returned string is safe to store in the database. Each call generates a
 * new random IV, so encrypting the same secret twice produces different output.
 */
export function encryptTotpSecret(plaintext: string, adminSessionSecret: string): string {
  const key = deriveKey(adminSessionSecret);
  const iv = randomBytes(12); // 96-bit IV (standard for GCM mode)
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
}

/**
 * Decrypts an AES-256-GCM encrypted TOTP secret.
 * 
 * @param encrypted - The stored encrypted string (format: base64(iv):base64(ciphertext):base64(authTag))
 * @param adminSessionSecret - The ADMIN_SESSION_SECRET env var (must be the same one used to encrypt)
 * @returns The original base32-encoded TOTP secret
 * @throws Error if the format is wrong or the auth tag doesn't match (tampered data)
 */
export function decryptTotpSecret(encrypted: string, adminSessionSecret: string): string {
  const key = deriveKey(adminSessionSecret);
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted TOTP secret format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const ciphertext = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}
