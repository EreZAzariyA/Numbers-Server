import { Model } from "mongoose";
import { Transaction, TransactionStatuses, TransactionTypes } from "israeli-bank-scrapers-for-e.a-servers/lib/transactions";
import { ClientError } from "../models";
import { Transactions, CardTransactions } from "../collections";
import { isCardProviderCompany } from "../utils/helpers";
import { MainTransactionType, RecurringGroup, Frequency, PatternAnchor } from "../utils/types";
import cacheService from "../utils/cache-service";
import { normalize, descriptionKey } from "./recurring/normalization";
import { detectFrequency as detectRecurringFrequency, nextUpcomingOccurrence, MIN_RECURRING_OCCURRENCES } from "./recurring/frequency-detection";
import { buildSettlementTreatmentMap, classifySettlement } from "../utils/settlement-detection";
import config from "../utils/config";
import { isRedisAvailable } from "../utils/connectRedis";
import {
  getCardLast4,
  getEventDate,
  getPostingDate,
  getTransactionAmount,
  getTransactionTextSource,
} from "../utils/transaction-semantics";

export type TransactionParams = {
  query: object;
  projection: object;
  options: object;
};

// Lazy-loaded so the module is safe to import before Mongoose/BullMQ are wired up.
const invalidateUserDerivedCaches = async (user_id: string): Promise<void> => {
  await Promise.all([
    cacheService.del(`cashFlow:${user_id}`),
    // forecast/health are keyed by language (and a :lite variant for chat context),
    // so clear by pattern rather than an exact key that would never match.
    cacheService.delByPattern(`forecast:${user_id}:*`),
    cacheService.delByPattern(`financialHealth:${user_id}:*`),
    cacheService.del(`patterns:${user_id}`),
  ]);
};

const enqueuePatternRecomputeSafe = async (user_id: string): Promise<void> => {
  if (!config.enablePatternPersistence || !isRedisAvailable()) return;
  try {
    // Dynamic import keeps BullMQ queue creation lazy; avoids module-init cycles
    // when this file is imported before queues/index.ts has initialised Redis.
    const { enqueuePatternRecompute } = await import('../queues');
    await enqueuePatternRecompute(user_id);
  } catch (err: any) {
    config.log?.warn?.({ err: err.message, user_id }, 'Failed to enqueue pattern recompute');
  }
};

class TransactionsLogic {
  fetchUserTransactions = async (
    user_id: string,
    params: Partial<TransactionParams>,
    type?: string,
  ): Promise<{ transactions: (MainTransactionType)[], total: number }> => {
    const { query, projection, options } = params;
    const collection: Model<any> = type === 'creditCards' ? CardTransactions : Transactions;

    let transactions = [];
    let total: number = 0;

      total = await collection.countDocuments({ user_id, ...query });
      transactions = await collection.find({ user_id, ...query }, projection, { ...options, sort: { 'eventDate': -1, 'date': -1 } });

    return {
      transactions,
      total
    };
  };

  fetchUserBankTransaction = async (
    transaction: Transaction,
    companyId: string,
    user_id: string
  ): Promise<MainTransactionType> => {
    const isCardTransaction = isCardProviderCompany(companyId);
    let trans: MainTransactionType = undefined;
    const query: object = {
      ...(transaction?.identifier ? {
          identifier: isCardTransaction ? transaction.identifier.toString() : transaction.identifier
        } : {
          ...(transaction?.memo ? {
            memo: transaction.memo
          } : {}),
          ...(getEventDate(transaction) ? {
            eventDate: getEventDate(transaction)
          } : {}),
           companyId,
           description: transaction.description,
           amount: transaction.chargedAmount ?? transaction.originalAmount,
         }),
    };

    let collection: Model<any> = Transactions;
    if (isCardTransaction) {
      collection = CardTransactions;
    }

    trans = await collection.findOne({ user_id, ...query }).exec();
    return trans;
  };

  newTransaction = async (
    user_id: string,
    transaction: MainTransactionType,
    type?: string
  ): Promise<MainTransactionType> => {
    if (!user_id) {
      throw new ClientError(500, 'User id is missing');
    }
    const isCardTransaction = isCardProviderCompany(transaction.companyId) || type !== 'transactions';
    let newTransaction: MainTransactionType = null;

    if (isCardTransaction) {
      newTransaction = new CardTransactions({
        user_id,
        cardNumber: getCardLast4(transaction) || null,
        cardLast4: getCardLast4(transaction) || null,
        ...transaction
      });
    } else {
      newTransaction = new Transactions({
        user_id,
        ...transaction
      });
    }

    const errors = newTransaction.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    const savedTransaction = await newTransaction.save();
    await invalidateUserDerivedCaches(user_id);
    await enqueuePatternRecomputeSafe(user_id);
    return savedTransaction;
  };

  updateTransaction = async (user_id: string, transaction: MainTransactionType, type: string = 'Account'): Promise<MainTransactionType> => {
    const isCardTransaction = type !== 'transactions';
    const collection: Model<any> = isCardTransaction ? CardTransactions : Transactions;

    const currentTransaction = await collection.findOne({ user_id, _id: transaction._id }).exec();
    if (!currentTransaction) {
      throw new ClientError(400, 'User transaction not found');
    }

    const updatedTransaction = await collection.findOneAndUpdate({ user_id, _id: transaction._id }, {
      $set: {
        ...transaction,
        eventDate: getEventDate(transaction),
        postingDate: getPostingDate(transaction),
        date: getEventDate(transaction),
        processedDate: getPostingDate(transaction),
        category_id: transaction.category_id,
        description: transaction.description,
        amount: transaction.amount,
        status: transaction.status || TransactionStatuses.Completed,
      }
    }, { new: true }).exec();

    const errors = updatedTransaction.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    await invalidateUserDerivedCaches(user_id);
    await enqueuePatternRecomputeSafe(user_id);
    return updatedTransaction;
  };

  updateTransactionStatus = async (
    transaction: MainTransactionType,
    status: TransactionStatuses
  ): Promise<MainTransactionType> => {
    const isCardProvider = isCardProviderCompany(transaction.companyId);
    if (isCardProvider) {
      return await CardTransactions.findByIdAndUpdate(
        transaction._id,
        { $set: { status } },
        { new: true }
      ).exec();
    }
    return await Transactions.findByIdAndUpdate(
      transaction._id,
      { $set: { status } },
      { new: true }
    ).exec();
  };

  removeTransaction = async (user_id: string, transaction_id: string, type: string = 'transactions'): Promise<void> => {
    const isCardTransaction = type !== 'transactions';
    const query = { user_id, _id: transaction_id };
    try {
      if (isCardTransaction) {
        await CardTransactions.findOneAndDelete(query).exec();
      } else {
        await Transactions.findOneAndDelete(query).exec();
      }
      await invalidateUserDerivedCaches(user_id);
      await enqueuePatternRecomputeSafe(user_id);
    } catch (err: any) {
      console.log(err);
    }
  };
};

const clusterByAmount = (items: any[]): any[][] => {
  const clusters: any[][] = [];
  for (const item of items) {
    const matched = clusters.find((c) => {
      const avg = c.reduce((s: number, x: any) => s + x.absoluteAmount, 0) / c.length;
      return Math.abs(item.absoluteAmount - avg) / Math.max(avg, 1) <= 0.05;
    });
    if (matched) {
      matched.push(item);
    } else {
      clusters.push([item]);
    }
  }
  return clusters;
};

/**
 * DOM-anchored frequency detection.
 * Computes modal day-of-month; if concentration is high we snap nextExpected to
 * that DOM in the next month. Otherwise falls back to lastDate + periodDays.
 */
const detectFrequency = (items: any[]): {
  frequency: Frequency | 'irregular';
  nextExpected: string | null;
  anchor?: PatternAnchor;
} => {
  const sorted = [...items].sort((a, b) =>
    new Date(a.postingDate).getTime() - new Date(b.postingDate).getTime()
  );
  if (sorted.length < MIN_RECURRING_OCCURRENCES) return { frequency: 'irregular', nextExpected: null };

  const dates = sorted.map((item) => item.postingDate);
  const lastDate = sorted[sorted.length - 1].postingDate;
  const result = detectRecurringFrequency(dates);
  if (result.freq === 'unknown' || result.freq === 'irregular') {
    return { frequency: 'irregular', nextExpected: null, anchor: result.anchor };
  }

  return {
    frequency: result.freq,
    nextExpected: nextUpcomingOccurrence(lastDate, result.freq, result.anchor),
    anchor: result.anchor,
  };
};

const getRecurringKind = (amount: number): 'income' | 'expense' =>
  amount >= 0 ? 'income' : 'expense';

const isInstallmentLike = (transaction: any): boolean =>
  transaction?.type === TransactionTypes.Installments || Boolean(transaction?.installments?.total);

const isSettlementRecurringGroup = (group: RecurringGroup): boolean =>
  classifySettlement(group.description ?? group.normalizedDescription ?? '', false) !== 'normal';

const isRecurringGroupValid = (group: RecurringGroup): boolean =>
  !isSettlementRecurringGroup(group) && (
    Boolean(group.userOverride?.confirmed) || (
    group.occurrences >= MIN_RECURRING_OCCURRENCES &&
    group.frequency !== 'unknown' &&
    group.frequency !== 'irregular'
    )
  );

const hasLegacyPatternKey = (group: RecurringGroup): boolean =>
  Boolean(group.merchantKey) && !/^(bank|card):(income|expense):/.test(group.merchantKey);

type RecurringDateBasis = 'settlement' | 'event';

type DetectRecurringTransactionsOptions = {
  dateBasis?: RecurringDateBasis;
};

const getGroupOccurrenceDates = (
  group: RecurringGroup,
  dateBasis: RecurringDateBasis
): string[] => {
  return group.transactions
    ?.map((transaction) => {
      if (dateBasis === 'event') {
        return transaction.eventDate || transaction.postingDate;
      }

      return transaction.postingDate || transaction.eventDate;
    })
    .filter(Boolean)
    .sort() ?? [];
};

const getNextExpectedForGroup = (
  group: RecurringGroup,
  referenceDate: string,
  dateBasis: RecurringDateBasis
): string | null => {
  if (!group.frequency || group.frequency === 'unknown' || group.frequency === 'irregular') {
    return group.nextExpected;
  }

  const occurrenceDates = getGroupOccurrenceDates(group, dateBasis);
  const lastSeen = occurrenceDates[occurrenceDates.length - 1];
  if (!lastSeen) {
    return group.nextExpected;
  }

  let anchor = group.anchor;
  const recalculated = detectRecurringFrequency(occurrenceDates);
  if (recalculated.freq !== 'unknown' && recalculated.freq !== 'irregular') {
    anchor = recalculated.anchor;
  }

  if (!anchor) {
    return group.nextExpected;
  }

  return nextUpcomingOccurrence(lastSeen, group.frequency as Frequency, anchor, referenceDate);
};

const liveDetect = async (user_id: string): Promise<RecurringGroup[]> => {
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const sinceStr = since.toISOString().slice(0, 10); // "YYYY-MM-DD" — date field is stored as string

  const [regularTxns, cardTxns] = await Promise.all([
    Transactions.find({ user_id, status: TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
    CardTransactions.find({ user_id, status: TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
  ]);

  // Settlement rows should never become recurring spending patterns, even if
  // they are the only card-payment signal available in the bank ledger.
  const hasCardData = cardTxns.length > 0;
  const settlementTreatments = buildSettlementTreatmentMap(regularTxns, cardTxns);

  const all = [...regularTxns, ...cardTxns].map((t: any) => ({
    _id: t._id.toString(),
    eventDate: getEventDate(t),
    postingDate: getPostingDate(t),
    amount: getTransactionAmount(t),
    absoluteAmount: Math.abs(getTransactionAmount(t)),
    description: t.description ?? '',
    normalizedSource: getTransactionTextSource(t),
    companyId: t.companyId ?? '',
    kind: getRecurringKind(getTransactionAmount(t)),
    source: (isCardProviderCompany(t.companyId) ? 'card' : 'bank') as 'bank' | 'card',
    type: t.type,
    installments: t.installments,
  })).filter((t) =>
    t.absoluteAmount > 0 &&
    !isInstallmentLike(t) &&
    (settlementTreatments.get(t._id) ?? classifySettlement(t.description, hasCardData)) === 'normal'
  );

  // Group by (source, kind, normalized description) so bank and card stay separate.
  const byNorm: Map<string, typeof all> = new Map();
  for (const t of all) {
    const normalizedDescription = normalize(t.normalizedSource);
    if (!normalizedDescription) continue;
    const key = `${t.source}:${t.kind}:${descriptionKey(t.normalizedSource)}`;
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key)!.push(t);
  }

  const groups: RecurringGroup[] = [];

  for (const [, items] of byNorm) {
    const clusters = clusterByAmount(items);
    for (const cluster of clusters) {
      if (cluster.length < MIN_RECURRING_OCCURRENCES) continue;
      const months = new Set(cluster.map((t) => t.postingDate.slice(0, 7)));
      if (months.size < 2) continue;

      const avgAmount = cluster.reduce((s: number, t: any) => s + t.absoluteAmount, 0) / cluster.length;
      const totalSpent = cluster.reduce((s: number, t: any) => s + t.absoluteAmount, 0);
      const { frequency, nextExpected, anchor } = detectFrequency(cluster);
      if (frequency === 'irregular') continue;
      const source = cluster[0].source;

      groups.push({
        description: cluster[0].description,
        normalizedDescription: normalize(cluster[0].normalizedSource),
        kind: cluster[0].kind,
        amount: Math.round(avgAmount * 100) / 100,
        frequency,
        occurrences: cluster.length,
        nextExpected,
        totalSpent: Math.round(totalSpent * 100) / 100,
        transactions: cluster,
        anchor,
        source,
        merchantKey: `desc:${descriptionKey(cluster[0].normalizedSource)}`,
      });
    }
  }

  return groups.sort((a, b) => b.totalSpent - a.totalSpent);
};

/**
 * Recompute `nextExpected` for each group relative to today.
 * This prevents stale dates when groups are served from cache.
 */
const refreshNextExpected = (
  groups: RecurringGroup[],
  dateBasis: RecurringDateBasis = 'settlement'
): RecurringGroup[] => {
  const today = new Date().toISOString().slice(0, 10);
  return groups.map((group) => {
    if (!group.frequency || group.frequency === 'unknown' || group.frequency === 'irregular') {
      return group;
    }

    const next = getNextExpectedForGroup(group, today, dateBasis);
    return { ...group, nextExpected: next ?? group.nextExpected };
  });
};

const detectRecurringTransactions = async (
  user_id: string,
  options: DetectRecurringTransactionsOptions = {}
): Promise<RecurringGroup[]> => {
  const dateBasis = options.dateBasis ?? 'settlement';

  if (!config.enablePatternPersistence) {
    const groups = await liveDetect(user_id);
    return refreshNextExpected(groups, dateBasis);
  }

  // Persistence path — serve from cache → DB → live-detect with async recompute.
  try {
    const cached = await cacheService.get<RecurringGroup[]>(`patterns:${user_id}`);
    if (cached) {
      if (cached.some(hasLegacyPatternKey)) {
        await cacheService.del(`patterns:${user_id}`);
      } else {
        const filteredCached = cached.filter(isRecurringGroupValid);
        if (filteredCached.length !== cached.length) {
          await cacheService.set(`patterns:${user_id}`, filteredCached, 600);
        }
        return refreshNextExpected(filteredCached, dateBasis);
      }
    }

    const { getRecurringGroups } = await import('./recurring/pattern-service');
    const groups = (await getRecurringGroups(user_id)).filter(isRecurringGroupValid);
    if (groups && groups.length > 0) {
      await cacheService.set(`patterns:${user_id}`, groups, 600);
      return refreshNextExpected(groups, dateBasis);
    }

    // Empty persisted state — fall back to live detection + async seed.
    const live = await liveDetect(user_id);
    await enqueuePatternRecomputeSafe(user_id);
    return refreshNextExpected(live, dateBasis);
  } catch (err: any) {
    config.log?.warn?.({ err: err.message, user_id }, 'Persisted pattern read failed; falling back to live detect');
    const live = await liveDetect(user_id);
    return refreshNextExpected(live, dateBasis);
  }
};

const transactionsLogic = new TransactionsLogic();
export { detectRecurringTransactions, liveDetect, invalidateUserDerivedCaches };
export default transactionsLogic;
