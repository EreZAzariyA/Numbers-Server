require('dotenv').config();

import mongoose from 'mongoose';
import { Transactions, CardTransactions } from '../src/collections';
import config from '../src/utils/config';
import { isCardProviderCompany } from '../src/utils/helpers';
import { classifySettlement } from '../src/utils/settlement-detection';
import {
  getCardLast4,
  getCounterparty,
  getEventDate,
  getMcc,
  getMerchantId,
  getPostingDate,
  getProviderCategoryName,
  getTransactionAmount,
  getTransactionTextSource,
} from '../src/utils/transaction-semantics';
import { TransactionTypes } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';

type TransactionDoc = {
  _id: mongoose.Types.ObjectId;
  companyId?: string;
  type?: string;
  installments?: { total?: number };
  semanticType?: string;
  rawTransaction?: any;
  [key: string]: any;
};

const BATCH_SIZE = 500;

const inferSemanticType = (transaction: TransactionDoc): string => {
  const text = getTransactionTextSource(transaction);
  if (classifySettlement(text, false) !== 'normal') {
    return 'card_settlement';
  }

  if (
    transaction.type === TransactionTypes.Installments ||
    (transaction.installments?.total ?? 0) > 1
  ) {
    return 'installment';
  }

  const amount = getTransactionAmount(transaction);
  if (amount >= 0) {
    return isCardProviderCompany(transaction.companyId) ? 'refund' : 'deposit';
  }

  return isCardProviderCompany(transaction.companyId) ? 'merchant_charge' : 'bank_transfer';
};

const buildUpdate = (transaction: TransactionDoc) => {
  const merchantId = getMerchantId(transaction) || undefined;
  const mcc = getMcc(transaction) ?? undefined;
  const cardLast4 = getCardLast4(transaction) || undefined;

  return {
    eventDate: getEventDate(transaction),
    postingDate: getPostingDate(transaction),
    providerCategoryName: getProviderCategoryName(transaction) || null,
    counterparty: getCounterparty(transaction) || null,
    cardLast4: cardLast4 ?? null,
    semanticType: transaction.semanticType || inferSemanticType(transaction),
    merchantId: merchantId ?? null,
    mcc: mcc ?? null,
    ...(merchantId ? {} : { merchantId: null }),
    ...(cardLast4 ? { cardNumber: transaction.cardNumber ?? cardLast4 } : {}),
  };
};

const backfillCollection = async (
  collection: any,
  label: string,
) => {
  let processed = 0;
  let updated = 0;
  let batch: any[] = [];

  const cursor = collection.find({}).lean().cursor();
  for await (const transaction of cursor as AsyncIterable<TransactionDoc>) {
    processed += 1;
    const update = buildUpdate(transaction);
    batch.push({
      updateOne: {
        filter: { _id: transaction._id },
        update: { $set: update },
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
    await backfillCollection(Transactions, 'transactions');
    await backfillCollection(CardTransactions, 'cardTransactions');
  } finally {
    await mongoose.disconnect();
  }
};

void run().catch((error) => {
  console.error('Semantic backfill failed', error);
  process.exit(1);
});
