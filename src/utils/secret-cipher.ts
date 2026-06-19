import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const PAYLOAD_PARTS = 3;
const HEX_PATTERN = /^[0-9a-f]+$/i;

const deriveKey = (secret: string): Buffer => crypto.createHash('sha256').update(secret).digest();

// Encrypts plaintext with AES-256-GCM and returns "iv:authTag:ciphertext" (hex).
export const encryptWithSecret = (plaintext: string, secret: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decryptWithSecret = (value: string | null | undefined, secret: string): string => {
  if (!value) return '';

  const [ivHex, authTagHex, encryptedHex] = value.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) return '';

  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
};

// True when value has the iv:authTag:ciphertext hex shape produced by encryptWithSecret.
// Used to distinguish encrypted payloads from legacy formats during migration.
export const isEncryptedPayload = (value: string): boolean => {
  const parts = value.split(':');
  return parts.length === PAYLOAD_PARTS && parts.every((part) => part.length > 0 && HEX_PATTERN.test(part));
};
