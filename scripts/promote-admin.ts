/**
 * One-time CLI: promote a user to admin by email address.
 *
 * Run from Numbers-Server/:
 *   npm run admin:promote -- --email=someone@example.com
 *
 * After running, the target user must log out and back in to receive
 * a new JWT containing role: 'admin'.
 */
require('dotenv').config();

import mongoose from 'mongoose';
import { UserModel } from '../src/models/user-model';
import config from '../src/utils/config';

const getEmailArg = (): string => {
  const arg = process.argv.find((a) => a.startsWith('--email='));
  if (!arg) throw new Error('Missing required argument: --email=<address>');
  const email = arg.split('=')[1]?.trim();
  if (!email) throw new Error('Email argument is empty');
  return email;
};

const promote = async (): Promise<void> => {
  const email = getEmailArg();

  if (!config.mongoConnectionString) {
    throw new Error('Mongo connection string is missing');
  }

  await mongoose.connect(config.mongoConnectionString);

  const user = await UserModel.findOne({ 'emails.email': email }).exec();
  if (!user) {
    throw new Error(`No user found with email: ${email}`);
  }

  if ((user as unknown as { role?: string }).role === 'admin') {
    config.log.info({ email }, 'User is already an admin — no change made');
    return;
  }

  await UserModel.findByIdAndUpdate(user._id, { $set: { role: 'admin' } }).exec();
  config.log.info(
    { email, user_id: user._id.toString() },
    'User promoted to admin. They must log out and back in to receive an updated token.',
  );
};

promote()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    config.log.error({ err: message }, 'Admin promotion failed');
    await mongoose.disconnect();
    process.exit(1);
  });
