import notificationsLogic from './notifications';
import { calculateCashFlowProjection } from './cash-flow-projection';
import { getSubscriptions, PRICE_INCREASE_THRESHOLD_PCT } from './subscriptions';
import { getUpcomingRenewals, DEFAULT_RENEWAL_WINDOW_DAYS } from './recurring/renewals';
import { fetchCompletedTransactions } from './shared/transaction-queries';
import { filterAndTallySettlements } from './shared/settlement-filter';
import { buildSettlementTreatmentMap } from '../utils/settlement-detection';
import { getTransactionAmount, getTransactionTextSource } from '../utils/transaction-semantics';
import { normalize } from './recurring/normalization';
import { monthBounds, toDateStr } from '../utils/date-helpers';
import config from '../utils/config';

// A merchant's current-month spend must exceed its monthly baseline by both this
// ratio AND this absolute amount before it is flagged — keeps noise down.
const ANOMALY_LOOKBACK_MONTHS = 6;
const ANOMALY_RATIO = 1.5;
const ANOMALY_MIN_DELTA = 150;
const ANOMALY_MAX_ALERTS = 3;

const monthKey = (date: Date): string => toDateStr(date).slice(0, 7);

const formatAmount = (value: number): string => Math.round(value).toLocaleString();

const safeRun = async (label: string, fn: () => Promise<void>): Promise<void> => {
  try {
    await fn();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    config.log.error({ label }, `Alert generation step failed: ${message}`);
  }
};

const generateOverdraftAlert = async (user_id: string, ym: string): Promise<void> => {
  const projection = await calculateCashFlowProjection(user_id);
  const willOverdraw = projection.projectedEndBalance !== null && projection.projectedEndBalance < 0;
  if (projection.riskLevel !== 'high' && !willOverdraw) return;

  const balanceText = projection.projectedEndBalance !== null
    ? ` Projected end-of-month balance: ${formatAmount(projection.projectedEndBalance)}.`
    : '';

  await notificationsLogic.create(user_id, {
    type: 'overdraft-risk',
    severity: 'critical',
    title: 'Cash-flow risk this month',
    body: `Your spending pace may push you into the red.${balanceText}`,
    meta: {
      riskLevel: projection.riskLevel,
      projectedEndBalance: projection.projectedEndBalance,
      projectedMonthNet: projection.projectedMonthNet,
    },
    dedupeKey: `overdraft:${ym}`,
  });
};

const generatePriceIncreaseAlerts = async (user_id: string): Promise<void> => {
  const { subscriptions } = await getSubscriptions(user_id);
  const increased = subscriptions.filter(
    (sub) => sub.priceChangePct !== null && sub.priceChangePct >= PRICE_INCREASE_THRESHOLD_PCT,
  );

  for (const sub of increased) {
    await notificationsLogic.create(user_id, {
      type: 'subscription-price-increase',
      severity: 'warning',
      title: `${sub.name} price went up`,
      body: `Now ${formatAmount(sub.currentAmount)} (was ${formatAmount(sub.previousAmount ?? 0)}, +${sub.priceChangePct}%).`,
      meta: {
        merchantKey: sub.merchantKey,
        currentAmount: sub.currentAmount,
        previousAmount: sub.previousAmount,
        priceChangePct: sub.priceChangePct,
      },
      dedupeKey: `price:${sub.merchantKey}:${sub.currentAmount}`,
    });
  }
};

const generateRenewalAlerts = async (user_id: string): Promise<void> => {
  const renewals = await getUpcomingRenewals(user_id, DEFAULT_RENEWAL_WINDOW_DAYS);
  for (const renewal of renewals) {
    await notificationsLogic.create(user_id, {
      type: 'upcoming-bill',
      severity: 'info',
      title: `${renewal.description} renews soon`,
      body: `${formatAmount(renewal.amount)} expected on ${renewal.nextExpected} (in ${renewal.daysUntil} day(s)).`,
      meta: {
        merchantKey: renewal.merchantKey,
        amount: renewal.amount,
        nextExpected: renewal.nextExpected,
      },
      dedupeKey: `renewal:${renewal.patternId ?? renewal.merchantKey}:${renewal.nextExpected}`,
    });
  }
};

const spendByMerchant = (txns: unknown[], treatments: ReturnType<typeof buildSettlementTreatmentMap>, hasCardData: boolean): Map<string, number> => {
  const dataQuality = { lowConfidenceSettlementCount: 0, lowConfidenceSettlementSpend: 0 };
  const kept = filterAndTallySettlements(
    txns,
    treatments,
    hasCardData,
    {
      id: (t: unknown) => (t as { _id?: { toString?: () => string } })._id?.toString?.() ?? '',
      text: (t: unknown) => getTransactionTextSource(t as Parameters<typeof getTransactionTextSource>[0]),
      amount: (t: unknown) => getTransactionAmount(t as Parameters<typeof getTransactionAmount>[0]),
    },
    dataQuality,
  );

  const result = new Map<string, number>();
  for (const t of kept) {
    const amount = getTransactionAmount(t as Parameters<typeof getTransactionAmount>[0]);
    if (amount >= 0) continue;
    const merchant = normalize(getTransactionTextSource(t as Parameters<typeof getTransactionTextSource>[0]));
    if (!merchant) continue;
    result.set(merchant, (result.get(merchant) ?? 0) + Math.abs(amount));
  }
  return result;
};

const generateAnomalyAlerts = async (user_id: string, ym: string): Promise<void> => {
  const now = new Date();
  const current = monthBounds(now);
  const historyStart = monthBounds(new Date(now.getFullYear(), now.getMonth() - ANOMALY_LOOKBACK_MONTHS, 1)).start;
  const historyEnd = monthBounds(new Date(now.getFullYear(), now.getMonth() - 1, 1)).end;

  const [currentData, historyData] = await Promise.all([
    fetchCompletedTransactions(user_id, { eventDate: { $gte: current.start, $lte: toDateStr(now) } }),
    fetchCompletedTransactions(user_id, { eventDate: { $gte: historyStart, $lte: historyEnd } }),
  ]);

  const currentSpend = spendByMerchant(
    [...currentData.regularTxns, ...currentData.cardTxns],
    buildSettlementTreatmentMap(currentData.regularTxns, currentData.cardTxns),
    currentData.cardTxns.length > 0,
  );
  const historySpend = spendByMerchant(
    [...historyData.regularTxns, ...historyData.cardTxns],
    buildSettlementTreatmentMap(historyData.regularTxns, historyData.cardTxns),
    historyData.cardTxns.length > 0,
  );

  const anomalies = Array.from(currentSpend.entries())
    .map(([merchant, spent]) => {
      const baseline = (historySpend.get(merchant) ?? 0) / ANOMALY_LOOKBACK_MONTHS;
      return { merchant, spent, baseline, delta: spent - baseline };
    })
    .filter((a) => a.baseline > 0 && a.spent >= a.baseline * ANOMALY_RATIO && a.delta >= ANOMALY_MIN_DELTA)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, ANOMALY_MAX_ALERTS);

  for (const anomaly of anomalies) {
    await notificationsLogic.create(user_id, {
      type: 'spending-anomaly',
      severity: 'warning',
      title: `Unusual spend at ${anomaly.merchant}`,
      body: `${formatAmount(anomaly.spent)} this month vs a ${formatAmount(anomaly.baseline)} monthly average.`,
      meta: {
        merchant: anomaly.merchant,
        spent: Math.round(anomaly.spent),
        baseline: Math.round(anomaly.baseline),
      },
      dedupeKey: `anomaly:${anomaly.merchant}:${ym}`,
    });
  }
};

/**
 * Run every alert check for a single user. Each check is isolated so a failure in
 * one does not prevent the others from producing notifications. Notifications are
 * deduped by key inside notificationsLogic.create, so this is safe to run daily.
 */
export const generateAlertsForUser = async (user_id: string): Promise<void> => {
  const ym = monthKey(new Date());
  await safeRun('overdraft', () => generateOverdraftAlert(user_id, ym));
  await safeRun('price-increase', () => generatePriceIncreaseAlerts(user_id));
  await safeRun('renewals', () => generateRenewalAlerts(user_id));
  await safeRun('anomaly', () => generateAnomalyAlerts(user_id, ym));
};
