import { decode } from 'jsonwebtoken';
import config from './config';
import { UserBankCredentials } from './helpers';
import { decryptWithSecret, encryptWithSecret, isEncryptedPayload } from './secret-cipher';

// A dedicated key for bank credentials, separate from the JWT signing key when set.
// Falls back to the app secret so existing deployments keep working without new env.
const BANK_CREDENTIALS_SECRET = process.env.BANK_CREDENTIALS_ENCRYPTION_SECRET || config.secretKey;

export const encryptBankCredentials = (details: UserBankCredentials): string =>
  encryptWithSecret(JSON.stringify(details), BANK_CREDENTIALS_SECRET);

export const decryptBankCredentials = (value?: string | null): UserBankCredentials | null => {
  if (!value) return null;

  if (isEncryptedPayload(value)) {
    const json = decryptWithSecret(value, BANK_CREDENTIALS_SECRET);
    if (!json) return null;
    try {
      return JSON.parse(json) as UserBankCredentials;
    } catch {
      return null;
    }
  }

  // Legacy: credentials were stored as a signed JWT whose payload is only base64-encoded
  // (not encrypted). Decode it so existing accounts keep working until re-saved/migrated.
  const decoded = decode(value);
  return decoded ? (decoded as UserBankCredentials) : null;
};
