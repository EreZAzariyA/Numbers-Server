/**
 * One-off migration: re-encrypt bank credentials still stored in the legacy
 * (JWT, base64-plaintext) format using AES-256-GCM. Idempotent — already-encrypted
 * values are skipped, so it is safe to run more than once.
 *
 * Run from Numbers-Server/:  npm run migrate:encrypt-credentials
 */
require('dotenv').config();

import mongoose from 'mongoose';
import { Accounts } from '../src/collections';
import { decryptBankCredentials, encryptBankCredentials } from '../src/utils/bank-credentials';
import { isEncryptedPayload } from '../src/utils/secret-cipher';
import config from '../src/utils/config';

const migrate = async (): Promise<void> => {
  if (!config.mongoConnectionString) {
    throw new Error('Mongo connection string is missing');
  }
  await mongoose.connect(config.mongoConnectionString);

  const accounts = await Accounts.find({ 'banks.credentials': { $exists: true, $ne: null } }).exec();

  let scanned = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const account of accounts) {
    let changed = false;

    for (const bank of account.banks) {
      const credentials = bank.credentials;
      if (!credentials) continue;
      scanned++;

      if (isEncryptedPayload(credentials)) {
        skipped++;
        continue;
      }

      const decoded = decryptBankCredentials(credentials);
      if (!decoded) {
        failed++;
        config.log.warn({ user_id: account.user_id, bank_id: bank._id }, 'Could not decode legacy bank credentials');
        continue;
      }

      bank.credentials = encryptBankCredentials(decoded);
      changed = true;
      migrated++;
    }

    if (changed) {
      account.markModified('banks');
      await account.save();
    }
  }

  config.log.info({ scanned, migrated, skipped, failed }, 'Bank credential encryption migration complete');
};

migrate()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    config.log.error({ err: err.message }, 'Bank credential encryption migration failed');
    await mongoose.disconnect();
    process.exit(1);
  });
