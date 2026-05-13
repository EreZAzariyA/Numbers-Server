import crypto from 'crypto';
import config from './config';

const ENCRYPTION_SECRET = process.env.AI_SETTINGS_ENCRYPTION_SECRET || config.secretKey;
const ALGORITHM = 'aes-256-gcm';

const getKey = (): Buffer => crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

export const encryptAiSecret = (value: string): string => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decryptAiSecret = (value?: string | null): string => {
  if (!value) return '';

  const [ivHex, authTagHex, encryptedHex] = value.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) return '';

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
};

export const maskAiSecret = (value?: string | null): string | null => {
  if (!value) return null;
  const last4 = value.slice(-4);
  const maskLength = Math.max(4, value.length - 4);
  return `${'•'.repeat(maskLength)}${last4}`;
};
