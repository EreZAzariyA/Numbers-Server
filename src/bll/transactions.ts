import { Model } from "mongoose";
import { Transaction, TransactionStatuses, TransactionTypes } from "israeli-bank-scrapers-for-e.a-servers/lib/transactions";
import { ClientError, ICardTransactionModel, ITransactionModel } from "../models";
import { Transactions, CardTransactions } from "../collections";
import { isCardProviderCompany } from "../utils/helpers";
import { MainTransactionType, RecurringGroup } from "../utils/types";
import cacheService from "../utils/cache-service";
import { toDateStr, addDays, diffDays, ymd, dayOfMonth } from "../utils/date-helpers";
import { normalize, descriptionKey } from "./recurring/normalization";
import config from "../utils/config";

export type TransactionParams = {
  query: object;
  projection: object;
  options: object;
};

// Lazy-loaded so the module is safe to import before Mongoose/BullMQ are wired up.
const invalidateUserDerivedCaches = async (user_id: string): Promise<void> => {
  await Promise.all([
    cacheService.del(`cashFlow:${user_id}`),
    cacheService.del(`forecast:${user_id}`),
    cacheService.del(`financialHealth:${user_id}`),
    cacheService.del(`patterns:${user_id}`),
  ]);
};

const enqueuePatternRecomputeSafe = async (user_id: string): Promise<void> => {
  if (!config.enablePatternPersistence) return;
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
      transactions = await collection.find({ user_id, ...query }, projection, { ...options, sort: { 'date': -1 } });

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
          ...(transaction?.date ? {
            date: transaction.date
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
        cardNumber: transaction?.cardNumber || null,
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
        date: transaction.date,
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
  frequency: 'monthly' | 'weekly' | 'irregular';
  nextExpected: string | null;
  anchor?: { kind: 'dayOfMonth' | 'dayOfWeek'; value: number; stddevDays: number };
} => {
  const sorted = [...items].sort((a, b) =>
    new Date(a.processedDate).getTime() - new Date(b.processedDate).getTime()
  );
  if (sorted.length < 2) return { frequency: 'irregular', nextExpected: null };

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(diffDays(sorted[i - 1].processedDate, sorted[i].processedDate));
  }
  const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const lastDate = sorted[sorted.length - 1].processedDate;

  if (avgGap >= 25 && avgGap <= 35) {
    // DOM anchor — mode of day-of-month
    const doms = sorted.map((t) => dayOfMonth(t.processedDate));
    const domHist: Record<number, number> = {};
    for (const d of doms) domHist[d] = (domHist[d] ?? 0) + 1;
    const [modeDomStr] = Object.entries(domHist).sort(([, a], [, b]) => b - a)[0];
    const modeDom = parseInt(modeDomStr, 10);
    const concentration = (domHist[modeDom] ?? 0) / doms.length;
    const mean = doms.reduce((s, v) => s + v, 0) / doms.length;
    const stddev = Math.sqrt(
      doms.reduce((s, v) => s + (v - mean) ** 2, 0) / doms.length
    );

    if (concentration >= 0.5) {
      // Snap to modal DOM in the next month after lastDate.
      const last = new Date(lastDate);
      const year = last.getUTCFullYear();
      const month = last.getUTCMonth() + 1; // next month (zero-indexed)
      const overflowYear = month > 11 ? year + 1 : year;
      const overflowMonth = month > 11 ? 0 : month;
      return {
        frequency: 'monthly',
        nextExpected: ymd(overflowYear, overflowMonth, modeDom),
        anchor: { kind: 'dayOfMonth', value: modeDom, stddevDays: Math.round(stddev * 10) / 10 },
      };
    }

    return { frequency: 'monthly', nextExpected: addDays(lastDate, 30) };
  }

  if (avgGap >= 5 && avgGap <= 9) {
    // DOW anchor for weekly
    const dows = sorted.map((t) => new Date(t.processedDate).getUTCDay());
    const dowHist: Record<number, number> = {};
    for (const d of dows) dowHist[d] = (dowHist[d] ?? 0) + 1;
    const [modeDowStr] = Object.entries(dowHist).sort(([, a], [, b]) => b - a)[0];
    const modeDow = parseInt(modeDowStr, 10);
    const concentration = (dowHist[modeDow] ?? 0) / dows.length;

    if (concentration >= 0.5) {
      // Snap to modal DOW after lastDate.
      const lastDow = new Date(lastDate).getUTCDay();
      let delta = (modeDow - lastDow + 7) % 7;
      if (delta === 0) delta = 7;
      return {
        frequency: 'weekly',
        nextExpected: addDays(lastDate, delta),
        anchor: { kind: 'dayOfWeek', value: modeDow, stddevDays: 1 },
      };
    }

    return { frequency: 'weekly', nextExpected: addDays(lastDate, 7) };
  }

  return { frequency: 'irregular', nextExpected: null };
};

const getRecurringKind = (amount: number): 'income' | 'expense' =>
  amount >= 0 ? 'income' : 'expense';

const isInstallmentLike = (transaction: any): boolean =>
  transaction?.type === TransactionTypes.Installments || Boolean(transaction?.installments?.total);

const liveDetect = async (user_id: string): Promise<RecurringGroup[]> => {
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const sinceStr = since.toISOString().slice(0, 10); // "YYYY-MM-DD" — date field is stored as string

  const [regularTxns, cardTxns] = await Promise.all([
    Transactions.find({ user_id, status: TransactionStatuses.Completed, date: { $gte: sinceStr } }).lean().exec(),
    CardTransactions.find({ user_id, status: TransactionStatuses.Completed, date: { $gte: sinceStr } }).lean().exec(),
  ]);

  const all = [...regularTxns, ...cardTxns].map((t: any) => ({
    _id: t._id.toString(),
    date: toDateStr(t.date),
    processedDate: toDateStr(t.processedDate ?? t.date),
    amount: t.amount ?? t.chargedAmount ?? 0,
    absoluteAmount: Math.abs(t.amount ?? t.chargedAmount ?? 0),
    description: t.description ?? '',
    normalizedSource: t.description || t.memo || t.categoryDescription || t.channelName || '',
    companyId: t.companyId ?? '',
    kind: getRecurringKind(t.amount ?? t.chargedAmount ?? 0),
    type: t.type,
    installments: t.installments,
  })).filter((t) => t.absoluteAmount > 0 && !isInstallmentLike(t));

  // Group by normalized description
  const byNorm: Map<string, typeof all> = new Map();
  for (const t of all) {
    const normalizedDescription = normalize(t.normalizedSource);
    if (!normalizedDescription) continue;
    const key = `${t.kind}:${descriptionKey(t.normalizedSource)}`;
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key)!.push(t);
  }

  const groups: RecurringGroup[] = [];

  for (const [, items] of byNorm) {
    const clusters = clusterByAmount(items);
    for (const cluster of clusters) {
      const months = new Set(cluster.map((t) => t.processedDate.slice(0, 7)));
      if (months.size < 2) continue;

      const avgAmount = cluster.reduce((s: number, t: any) => s + t.absoluteAmount, 0) / cluster.length;
      const totalSpent = cluster.reduce((s: number, t: any) => s + t.absoluteAmount, 0);
      const { frequency, nextExpected, anchor } = detectFrequency(cluster);
      const companyId = cluster[0].companyId ?? '';
      const source: 'bank' | 'card' = isCardProviderCompany(companyId) ? 'card' : 'bank';

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

const detectRecurringTransactions = async (user_id: string): Promise<RecurringGroup[]> => {
  if (!config.enablePatternPersistence) {
    return liveDetect(user_id);
  }

  // Persistence path — serve from cache → DB → live-detect with async recompute.
  try {
    const cached = await cacheService.get<RecurringGroup[]>(`patterns:${user_id}`);
    if (cached) return cached;

    const { getRecurringGroups } = await import('./recurring/pattern-service');
    const groups = await getRecurringGroups(user_id);
    if (groups && groups.length > 0) {
      await cacheService.set(`patterns:${user_id}`, groups, 600);
      return groups;
    }

    // Empty persisted state — fall back to live detection + async seed.
    const live = await liveDetect(user_id);
    await enqueuePatternRecomputeSafe(user_id);
    return live;
  } catch (err: any) {
    config.log?.warn?.({ err: err.message, user_id }, 'Persisted pattern read failed; falling back to live detect');
    return liveDetect(user_id);
  }
};

const transactionsLogic = new TransactionsLogic();
export { detectRecurringTransactions, liveDetect, invalidateUserDerivedCaches };
export default transactionsLogic;
