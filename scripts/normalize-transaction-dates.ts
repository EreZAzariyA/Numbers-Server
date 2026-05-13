require('dotenv').config();

import mongoose from 'mongoose';
import { CardTransactions, Transactions } from '../src/collections';
import config from '../src/utils/config';
import { getEventDate, getPostingDate } from '../src/utils/transaction-semantics';

type TransactionDoc = {
  _id: mongoose.Types.ObjectId;
  eventDate?: string | Date | null;
  postingDate?: string | Date | null;
  date?: string | Date | null;
  processedDate?: string | Date | null;
  [key: string]: any;
};

const BATCH_SIZE = 500;

const buildUpdate = (transaction: TransactionDoc) => {
  const eventDate = getEventDate(transaction) || null;
  const postingDate = getPostingDate(transaction) || null;

  return {
    eventDate,
    postingDate,
    date: eventDate,
    processedDate: postingDate,
  };
};

const normalizeCollection = async (collection: any, label: string) => {
  let processed = 0;
  let updated = 0;
  let batch: any[] = [];

  const cursor = collection.find({}).lean().cursor();
  for await (const transaction of cursor as AsyncIterable<TransactionDoc>) {
    processed += 1;
    batch.push({
      updateOne: {
        filter: { _id: transaction._id },
        update: { $set: buildUpdate(transaction) },
      },
    });

    if (batch.length >= BATCH_SIZE) {
      const result = await collection.bulkWrite(batch, { ordered: false });
      updated += result.modifiedCount + result.upsertedCount;
      console.log(`[${label}] processed ${processed}, updated ${updated}`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    const result = await collection.bulkWrite(batch, { ordered: false });
    updated += result.modifiedCount + result.upsertedCount;
  }

  console.log(`[${label}] done. processed=${processed}, updated=${updated}`);
};

const run = async () => {
  if (!config.mongoConnectionString) {
    throw new Error('Mongo connection string is missing');
  }

  await mongoose.connect(config.mongoConnectionString);
  console.log(`Connected to ${config.mongoConnectionString}`);

  try {
    await normalizeCollection(Transactions, 'transactions');
    await normalizeCollection(CardTransactions, 'cardTransactions');
  } finally {
    await mongoose.disconnect();
  }
};

void run().catch((error) => {
  console.error('Transaction date normalization failed', error);
  process.exit(1);
});
