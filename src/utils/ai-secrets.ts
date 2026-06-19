import config from './config';
import { decryptWithSecret, encryptWithSecret } from './secret-cipher';

const ENCRYPTION_SECRET = process.env.AI_SETTINGS_ENCRYPTION_SECRET || config.secretKey;

export const encryptAiSecret = (value: string): string => encryptWithSecret(value, ENCRYPTION_SECRET);

export const decryptAiSecret = (value?: string | null): string => decryptWithSecret(value, ENCRYPTION_SECRET);

export const maskAiSecret = (value?: string | null): string | null => {
  if (!value) return null;
  const last4 = value.slice(-4);
  const maskLength = Math.max(4, value.length - 4);
  return `${'•'.repeat(maskLength)}${last4}`;
};
