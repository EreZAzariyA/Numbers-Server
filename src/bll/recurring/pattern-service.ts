import { TransactionStatuses, TransactionTypes } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { Transactions, CardTransactions, RecurringPatterns } from '../../collections';
import { IRecurringPatternModel } from '../../models/recurring-pattern-model';
import { RecurringGroup, PatternClass, Frequency, PatternAnchor } from '../../utils/types';
import { toDateStr, addDays } from '../../utils/date-helpers';
import { isCardProviderCompany } from '../../utils/helpers';
import { normalize } from './normalization';
import { buildMerchantKey, agreesOn } from './merchant-key';
import { clusterAmounts, AmountCluster } from './amount-clustering';
import { detectFrequency, nextOccurrence, FrequencyResult } from './frequency-detection';
import { classify } from './classifier';
import { computeConfidence } from './confidence';
import config from '../../utils/config';

// Maximum tx IDs stored per pattern for traceability.
const MAX_OCCURRENCE_TX_IDS = 24;

type PersistedRecurringSourceTransaction = {
  _id: { toString(): string };
  amount?: number;
  chargedAmount?: number;
  companyId?: string;
  date?: string | Date;
  description?: string;
  processedDate?: string | Date;
};

/**
 * Full recompute of all recurring patterns for a user.
 * This is the worker's main entry-point; it reads raw transactions,
 * groups/clusters/classifies them, then upserts `RecurringPatterns`.
 */
export const recomputePatterns = async (user_id: string): Promise<void> => {
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const sinceStr = since.toISOString().slice(0, 10);

  const [regularTxns, cardTxns] = await Promise.all([
    Transactions.find({ user_id, status: TransactionStatuses.Completed, date: { $gte: sinceStr } }).lean().exec(),
    CardTransactions.find({ user_id, status: TransactionStatuses.Completed, date: { $gte: sinceStr } }).lean().exec(),
  ]);

  // Prepare flat list with merchantKey.
  const allTxs = [...regularTxns, ...cardTxns].map((t: any) => ({
    _id: t._id.toString(),
    date: toDateStr(t.date),
    processedDate: toDateStr(t.processedDate ?? t.date),
    amount: t.amount ?? t.chargedAmount ?? 0,
    originalAmount: t.originalAmount,
    originalCurrency: t.originalCurrency,
    chargedAmount: t.chargedAmount,
    description: t.description ?? '',
    memo: t.memo ?? '',
    categoryDescription: t.categoryDescription ?? '',
    channelName: t.channelName ?? '',
    channel: t.channel ?? '',
    companyId: t.companyId ?? '',
    category_id: t.category_id?.toString() ?? '',
    rawTransaction: t.rawTransaction,
    type: t.type,
    installments: t.installments,
    kind: (t.amount ?? t.chargedAmount ?? 0) >= 0 ? 'income' : 'expense' as 'income' | 'expense',
    source: isCardProviderCompany(t.companyId) ? 'card' : 'bank' as 'bank' | 'card',
    merchantKey: '',
  })).filter((t) => Math.abs(t.amount) > 0);

  // Compute merchant keys.
  for (const tx of allTxs) {
    tx.merchantKey = buildMerchantKey(tx);
  }

  // Group by (kind, merchantKey) with agreesOn corroboration.
  const groupMap = new Map<string, typeof allTxs>();
  for (const tx of allTxs) {
    const groupKey = `${tx.kind}:${tx.merchantKey}`;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, [tx]);
      continue;
    }
    // Check signal agreement with any existing member.
    const existing = groupMap.get(groupKey)!;
    if (agreesOn(tx, existing[0], 1)) {
      existing.push(tx);
    } else {
      // Doesn't pass corroboration — start separate group under a disambiguated key.
      const altKey = `${groupKey}:${tx._id}`;
      if (!groupMap.has(altKey)) groupMap.set(altKey, []);
      groupMap.get(altKey)!.push(tx);
    }
  }

  // Load existing user overrides to preserve them across recomputes.
  const existingPatterns = await RecurringPatterns.find({ user_id }).lean().exec();
  const overrideByKey = new Map<string, IRecurringPatternModel['userOverride']>();
  for (const p of existingPatterns) {
    if (p.userOverride) overrideByKey.set(p.merchantKey, p.userOverride);
  }

  const upsertOps: any[] = [];

  for (const [, txGroup] of groupMap) {
    if (txGroup.length < 2) continue;

    // Amount clustering within the group.
    const clusters = clusterAmounts(txGroup);

    for (const cluster of clusters) {
      const clusterTxs = cluster.txIndices.map((i) => txGroup[i]);
      const months = new Set(clusterTxs.map((t) => t.processedDate.slice(0, 7)));
      if (months.size < 2) continue;

      const dates = clusterTxs.map((t) => t.processedDate);
      const freqResult: FrequencyResult = detectFrequency(dates);

      // Check for installment plan.
      const installmentTxs = clusterTxs.filter(
        (t) => t.type === TransactionTypes.Installments || t.installments?.total
      );
      let installmentPlan: IRecurringPatternModel['installmentPlan'] = null;
      if (installmentTxs.length > 0) {
        const latest = installmentTxs.sort(
          (a, b) => b.processedDate.localeCompare(a.processedDate)
        )[0];
        const total = latest.installments?.total ?? 0;
        const current = latest.installments?.number ?? 0;
        const remaining = Math.max(0, total - current);
        installmentPlan = {
          paymentsRemaining: remaining,
          totalPayments: total,
          monthlyAmount: cluster.mean,
          expectedLastPaymentDate: remaining > 0
            ? nextOccurrence(latest.processedDate, 'monthly', freqResult.anchor)
            : latest.processedDate,
        };
        // Recalculate expected last for remaining months.
        if (remaining > 1) {
          let d = latest.processedDate;
          for (let i = 0; i < remaining; i++) {
            d = nextOccurrence(d, 'monthly', freqResult.anchor);
          }
          installmentPlan.expectedLastPaymentDate = d;
        }
      }

      const amountStability = cluster.mean > 0
        ? Math.min(1, Math.max(0, 1 - (cluster.stddev / cluster.mean)))
        : 0;

      // Collect signals.
      const signals = {
        companyIds: [...new Set(clusterTxs.map((t) => t.companyId).filter(Boolean))],
        categoryIds: [...new Set(clusterTxs.map((t) => t.category_id).filter(Boolean))],
        channels: [...new Set(clusterTxs.map((t) => t.channel || t.channelName).filter(Boolean))],
        descriptionVariants: [...new Set(clusterTxs.map((t) => t.description).filter(Boolean))].slice(0, 10),
        memoVariants: [...new Set(clusterTxs.map((t) => t.memo).filter(Boolean))].slice(0, 10),
      };

      const kind = clusterTxs[0].kind;
      const merchantKey = clusterTxs[0].merchantKey;
      const source = clusterTxs[0].source;

      const classification: PatternClass = classify({
        kind,
        frequency: freqResult.freq,
        stability: freqResult.stability,
        amountStability,
        installmentTotal: installmentPlan?.totalPayments,
        channel: signals.channels[0],
        occurrences: clusterTxs.length,
        categoryDescription: clusterTxs[0].categoryDescription,
      });

      // Count missed cycles in last 6 expected periods.
      const missedInLast6Cycles = computeMissedCycles(dates, freqResult, 6);

      const userOverride = overrideByKey.get(merchantKey) ?? null;

      const confidence = computeConfidence({
        occurrences: clusterTxs.length,
        stability: freqResult.stability,
        amountMean: cluster.mean,
        amountStddev: cluster.stddev,
        signals,
        missedInLast6Cycles,
        userConfirmed: userOverride?.confirmed ?? false,
      });

      const sortedDates = [...dates].sort();
      const observed = {
        firstSeen: sortedDates[0],
        lastSeen: sortedDates[sortedDates.length - 1],
        occurrences: clusterTxs.length,
        missedInLast6Cycles,
        occurrenceTxIds: clusterTxs
          .sort((a, b) => b.processedDate.localeCompare(a.processedDate))
          .slice(0, MAX_OCCURRENCE_TX_IDS)
          .map((t) => t._id),
      };

      upsertOps.push({
        updateOne: {
          filter: { user_id, merchantKey },
          update: {
            $set: {
              source,
              classification,
              kind,
              frequency: freqResult.freq,
              anchor: freqResult.anchor,
              amount: {
                mean: Math.round(cluster.mean * 100) / 100,
                median: Math.round(cluster.median * 100) / 100,
                stddev: Math.round(cluster.stddev * 100) / 100,
                min: Math.round(cluster.min * 100) / 100,
                max: Math.round(cluster.max * 100) / 100,
                currency: cluster.currency,
                isFx: cluster.isFx,
              },
              installmentPlan,
              observed,
              confidence: Math.round(confidence * 1000) / 1000,
              stability: Math.round(freqResult.stability * 1000) / 1000,
              signals,
              // Only set userOverride if it was previously saved; never overwrite user choice.
              ...(userOverride ? {} : { userOverride: null }),
            },
            $setOnInsert: {
              user_id,
              merchantKey,
              ...(userOverride ? { userOverride } : {}),
            },
          },
          upsert: true,
        },
      });
    }
  }

  // Bulk upsert.
  if (upsertOps.length > 0) {
    await RecurringPatterns.bulkWrite(upsertOps, { ordered: false });
  }

  // Remove patterns that no longer have backing transactions (merchant key disappeared).
  const validKeys = new Set(upsertOps.map((op) => op.updateOne.filter.merchantKey));
  const stalePatterns = existingPatterns.filter((p) => !validKeys.has(p.merchantKey));
  if (stalePatterns.length > 0) {
    await RecurringPatterns.deleteMany({
      user_id,
      _id: { $in: stalePatterns.map((p) => p._id) },
      // Only delete patterns that weren't user-confirmed.
      'userOverride.confirmed': { $ne: true },
    }).exec();
  }

  config.log?.info?.({ user_id, patterns: upsertOps.length, stale: stalePatterns.length }, 'Pattern recompute done');
};

/**
 * Read persisted patterns for a user.
 */
export const getPatterns = async (user_id: string): Promise<IRecurringPatternModel[]> => {
  return RecurringPatterns.find({ user_id })
    .sort({ confidence: -1 })
    .lean()
    .exec() as any;
};

/**
 * Convert persisted patterns to the legacy RecurringGroup shape
 * so the existing FE contract stays unbroken.
 */
export const getRecurringGroups = async (user_id: string): Promise<RecurringGroup[]> => {
  const patterns = await getPatterns(user_id);
  const activePatterns = patterns.filter((p) => !(p.userOverride?.disabled));

  return Promise.all(activePatterns.map((pattern) => patternToRecurringGroup(pattern)));
};

const hydrateRecurringTransactionItems = async (p: IRecurringPatternModel) => {
  const occurrenceTxIds = p.observed.occurrenceTxIds ?? [];

  if (!occurrenceTxIds.length) {
    return [];
  }

  const [bankTransactions, cardTransactions] = await Promise.all([
    Transactions.find({ _id: { $in: occurrenceTxIds } })
      .lean()
      .exec() as Promise<PersistedRecurringSourceTransaction[]>,
    CardTransactions.find({ _id: { $in: occurrenceTxIds } })
      .lean()
      .exec() as Promise<PersistedRecurringSourceTransaction[]>,
  ]);

  const transactionsById = new Map<string, PersistedRecurringSourceTransaction>();

  for (const transaction of [...bankTransactions, ...cardTransactions]) {
    transactionsById.set(transaction._id.toString(), transaction);
  }

  return occurrenceTxIds.reduce<RecurringGroup["transactions"]>((items, id) => {
    const transaction = transactionsById.get(id);
    if (!transaction) {
      return items;
    }

    const amount = transaction.amount ?? transaction.chargedAmount ?? 0;
    const processedDateSource = transaction.processedDate || transaction.date;

    items.push({
      _id: transaction._id.toString(),
      date: transaction.date ? toDateStr(transaction.date) : '',
      processedDate: processedDateSource ? toDateStr(processedDateSource) : '',
      amount,
      description: transaction.description ?? p.signals.descriptionVariants[0] ?? '',
      companyId: transaction.companyId ?? p.signals.companyIds[0] ?? '',
      kind: amount >= 0 ? 'income' : 'expense',
    });

    return items;
  }, []);
};

const patternToRecurringGroup = async (p: IRecurringPatternModel): Promise<RecurringGroup> => {
  const lastSeen = p.observed.lastSeen;
  const next = p.frequency !== 'unknown'
    ? nextOccurrence(lastSeen, p.frequency, p.anchor)
    : null;

  const effectiveAmount = p.userOverride?.customAmount ?? p.amount.mean;
  const effectiveFreq = (p.userOverride?.customFrequency ?? p.frequency) as any;
  const effectiveClass = (p.userOverride?.customClassification ?? p.classification) as PatternClass;
  const transactions = await hydrateRecurringTransactionItems(p);

  return {
    description: p.signals.descriptionVariants[0] ?? p.merchantKey,
    normalizedDescription: normalize(p.signals.descriptionVariants[0] ?? ''),
    kind: p.kind,
    amount: Math.round(effectiveAmount * 100) / 100,
    frequency: effectiveFreq,
    occurrences: p.observed.occurrences,
    nextExpected: next,
    totalSpent: Math.round(effectiveAmount * p.observed.occurrences * 100) / 100,
    transactions,
    patternId: (p as any)._id?.toString(),
    classification: effectiveClass,
    confidence: p.confidence,
    anchor: p.anchor,
    installmentPlan: p.installmentPlan
      ? { paymentsRemaining: p.installmentPlan.paymentsRemaining, totalPayments: p.installmentPlan.totalPayments }
      : null,
    userOverride: p.userOverride
      ? { confirmed: p.userOverride.confirmed, disabled: p.userOverride.disabled }
      : null,
    merchantKey: p.merchantKey,
    source: p.source,
  };
};

/**
 * Apply a user override to a pattern.
 */
export const overridePattern = async (
  user_id: string,
  patternId: string,
  patch: Partial<{
    confirmed: boolean;
    disabled: boolean;
    customAmount: number;
    customFrequency: string;
    customClassification: string;
  }>
): Promise<IRecurringPatternModel | null> => {
  const update: any = {};
  for (const [key, val] of Object.entries(patch)) {
    update[`userOverride.${key}`] = val;
  }

  return RecurringPatterns.findOneAndUpdate(
    { _id: patternId, user_id },
    { $set: update },
    { new: true }
  ).exec();
};

// --- Internal helpers ---

/**
 * Estimate how many of the last N expected cycles were missed
 * (no matching transaction found within ±stddev window).
 */
function computeMissedCycles(
  dates: string[],
  freqResult: FrequencyResult,
  lookbackCycles: number
): number {
  if (freqResult.freq === 'unknown' || dates.length < 2) return 0;

  const sorted = [...dates].sort();
  const last = sorted[sorted.length - 1];
  let missed = 0;

  // Walk backwards from the last observed date.
  let expected = last;
  for (let i = 0; i < lookbackCycles; i++) {
    // Go one cycle back.
    const prevExpected = goBackOneCycle(expected, freqResult);
    const tolerance = Math.max(3, (freqResult.anchor.stddevDays ?? 2) * 2);
    // Check if any date falls within tolerance of prevExpected.
    const hit = sorted.some((d) => Math.abs(
      new Date(d).getTime() - new Date(prevExpected).getTime()
    ) / 86400000 <= tolerance);
    if (!hit) missed++;
    expected = prevExpected;
  }

  return missed;
}

function goBackOneCycle(dateStr: string, freq: FrequencyResult): string {
  const periodMap: Record<string, number> = {
    weekly: 7, biweekly: 14, monthly: 30, bimonthly: 60,
    quarterly: 91, semiannual: 182, annual: 365,
  };
  const days = periodMap[freq.freq] ?? 30;
  return addDays(dateStr, -days);
}
