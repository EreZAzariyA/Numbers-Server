import { InsightFinding } from '../../models';
import agentInsightsLogic from '../agent-insights';
import { calculateCashFlowProjection } from '../cash-flow-projection';
import { getSubscriptions, PRICE_INCREASE_THRESHOLD_PCT } from '../subscriptions';
import { getUpcomingRenewals } from '../recurring/renewals';
import { fetchCompletedTransactions } from '../shared/transaction-queries';
import { filterAndTallySettlements } from '../shared/settlement-filter';
import { buildSettlementTreatmentMap } from '../../utils/settlement-detection';
import { getTransactionAmount, getTransactionTextSource, getEventDate } from '../../utils/transaction-semantics';
import { normalize } from '../recurring/normalization';
import { toDateStr, addDays, monthBounds } from '../../utils/date-helpers';
import type { InsightLang } from '../../models/agent-insight-model';
import { i18n } from './insight-i18n';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGH_SPEND_RATIO = 2;
const HIGH_SPEND_MIN_TOTAL = 200;
const LARGE_TXN_THRESHOLD = 1000;
const WEEKLY_CHANGE_THRESHOLD_PCT = 20;
const RENEWAL_ALERT_WITHIN_DAYS = 7;
const INCOME_SKIP_DAY = 12;
const INCOME_PRIOR_MIN = 2000;
const INCOME_CHANGE_THRESHOLD_PCT = 10;
const ANOMALY_LOOKBACK_MONTHS = 6;
const ANOMALY_RATIO = 1.5;
const ANOMALY_MIN_DELTA = 150;
const ANOMALY_MAX_FLAGS = 3;
const DUPLICATE_WINDOW_HOURS = 48;
const DUPLICATE_AMOUNT_TOLERANCE = 0.05;
const DUPLICATE_MIN_OCCURRENCES = 2;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const fmt = (value: number): string => Math.round(value).toLocaleString();

const pct = (value: number): string => Math.round(Math.abs(value)).toString();

type RawTxn = Record<string, unknown>;

/** Sum absolute expenses (amount < 0) from a transaction list. */
const sumExpenses = (txns: RawTxn[]): number =>
  txns.reduce((acc, t) => {
    const amount = getTransactionAmount(t);
    return amount < 0 ? acc + Math.abs(amount) : acc;
  }, 0);

/** Sum income (amount > 0) from a transaction list. */
const sumIncome = (txns: RawTxn[]): number =>
  txns.reduce((acc, t) => {
    const amount = getTransactionAmount(t);
    return amount > 0 ? acc + amount : acc;
  }, 0);

/**
 * Fetch bank + card transactions for a date range and return them as a flat
 * list of RawTxn. Skips settlement deduplication — callers that need it apply
 * it themselves.
 */
const fetchAllTxns = async (user_id: string, start: string, end: string): Promise<RawTxn[]> => {
  const { regularTxns, cardTxns } = await fetchCompletedTransactions(user_id, {
    eventDate: { $gte: start, $lte: end },
  });
  return [...regularTxns, ...cardTxns] as RawTxn[];
};

/**
 * Fetch bank-only transactions for a date range (income detection needs bank
 * transactions specifically to catch salary deposits).
 */
const fetchBankTxns = async (user_id: string, start: string, end: string): Promise<RawTxn[]> => {
  const { regularTxns } = await fetchCompletedTransactions(user_id, {
    eventDate: { $gte: start, $lte: end },
  });
  return regularTxns as RawTxn[];
};

// ---------------------------------------------------------------------------
// 1. Daily Expense Review
// ---------------------------------------------------------------------------

export async function runDailyExpenseReview(user_id: string): Promise<void> {
  const now = new Date();
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterdayStr = toDateStr(yesterdayDate);

  try {
    const historyEnd = addDays(yesterdayStr, -1);
    const historyStart = addDays(historyEnd, -29);

    const [yesterdayTxns, historyTxns] = await Promise.all([
      fetchAllTxns(user_id, yesterdayStr, yesterdayStr),
      fetchAllTxns(user_id, historyStart, historyEnd),
    ]);

    const yesterdayTotal = sumExpenses(yesterdayTxns);
    const historyTotal = sumExpenses(historyTxns);
    const dailyAverage = historyTotal / 30;
    const isHighSpend =
      yesterdayTotal > HIGH_SPEND_RATIO * dailyAverage &&
      yesterdayTotal > HIGH_SPEND_MIN_TOTAL;
    const overPct =
      isHighSpend && dailyAverage > 0
        ? Math.round(((yesterdayTotal - dailyAverage) / dailyAverage) * 100)
        : 0;
    const largeTxns = yesterdayTxns.filter(
      (t) => Math.abs(getTransactionAmount(t)) >= LARGE_TXN_THRESHOLD,
    );

    const buildFindings = (lang: InsightLang): InsightFinding[] => {
      const t = i18n[lang];
      const findings: InsightFinding[] = [];
      findings.push({
        severity: 'info',
        title: t.dailySpendingTitle,
        body: t.dailySpendingBody(fmt(yesterdayTotal), fmt(dailyAverage)),
      });
      if (isHighSpend) {
        findings.push({
          severity: 'warning',
          title: t.higherThanUsualTitle,
          body: t.higherThanUsualBody(String(overPct)),
        });
      }
      for (const txn of largeTxns) {
        const description = getTransactionTextSource(txn);
        const amount = getTransactionAmount(txn);
        findings.push({
          severity: 'info',
          title: t.largeTxnTitle,
          body: `${description}: ₪${fmt(Math.abs(amount))}`,
          meta: { description, amount },
        });
      }
      return findings;
    };

    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'daily-expense-review', yesterdayStr, buildFindings('en'), undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'daily-expense-review', yesterdayStr, buildFindings('he'), undefined, 'he'),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'daily-expense-review', yesterdayStr, [{
        severity: 'warning',
        title: i18n.en.analysisUnavailableTitle,
        body: i18n.en.dailyUnavailableBody(msg),
      }], undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'daily-expense-review', yesterdayStr, [{
        severity: 'warning',
        title: i18n.he.analysisUnavailableTitle,
        body: i18n.he.dailyUnavailableBody(msg),
      }], undefined, 'he'),
    ]);
  }
}

// ---------------------------------------------------------------------------
// 2. Weekly Summary
// ---------------------------------------------------------------------------

export async function runWeeklySummary(user_id: string): Promise<void> {
  const todayStr = toDateStr(new Date());

  try {
    const thisWeekStart = addDays(todayStr, -6);
    const lastWeekEnd = addDays(todayStr, -7);
    const lastWeekStart = addDays(todayStr, -13);

    const [thisWeekTxns, lastWeekTxns] = await Promise.all([
      fetchAllTxns(user_id, thisWeekStart, todayStr),
      fetchAllTxns(user_id, lastWeekStart, lastWeekEnd),
    ]);

    const thisWeekTotal = sumExpenses(thisWeekTxns);
    const lastWeekTotal = sumExpenses(lastWeekTxns);

    let deltaLabel = '0%';
    let deltaNum = 0;
    if (lastWeekTotal > 0) {
      deltaNum = ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100;
      const sign = deltaNum >= 0 ? '+' : '-';
      deltaLabel = `${sign}${pct(deltaNum)}%`;
    }
    const isUp = deltaNum > WEEKLY_CHANGE_THRESHOLD_PCT;
    const isDown = deltaNum < -WEEKLY_CHANGE_THRESHOLD_PCT;

    const buildFindings = (lang: InsightLang): InsightFinding[] => {
      const t = i18n[lang];
      const findings: InsightFinding[] = [];
      findings.push({
        severity: 'info',
        title: t.weeklySpendingTitle,
        body: t.weeklySpendingBody(fmt(thisWeekTotal), fmt(lastWeekTotal), deltaLabel),
      });
      if (isUp) {
        findings.push({
          severity: 'warning',
          title: t.spendingUpTitle,
          body: t.spendingUpBody(pct(deltaNum), fmt(thisWeekTotal), fmt(lastWeekTotal)),
        });
      } else if (isDown) {
        findings.push({
          severity: 'info',
          title: t.spendingDownTitle,
          body: t.spendingDownBody(pct(deltaNum), fmt(thisWeekTotal), fmt(lastWeekTotal)),
        });
      }
      return findings;
    };

    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'weekly-summary', todayStr, buildFindings('en'), undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'weekly-summary', todayStr, buildFindings('he'), undefined, 'he'),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'weekly-summary', todayStr, [{
        severity: 'warning',
        title: i18n.en.analysisUnavailableTitle,
        body: i18n.en.weeklyUnavailableBody(msg),
      }], undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'weekly-summary', todayStr, [{
        severity: 'warning',
        title: i18n.he.analysisUnavailableTitle,
        body: i18n.he.weeklyUnavailableBody(msg),
      }], undefined, 'he'),
    ]);
  }
}

// ---------------------------------------------------------------------------
// 3. Month-End Risk
// ---------------------------------------------------------------------------

export async function runMonthEndRisk(user_id: string): Promise<void> {
  const todayStr = toDateStr(new Date());

  try {
    const projection = await calculateCashFlowProjection(user_id);
    const { riskLevel, projectedEndBalance } = projection;
    const balanceStr =
      projectedEndBalance !== null ? `₪${fmt(projectedEndBalance)}` : 'unknown';
    const isHigh =
      riskLevel === 'high' ||
      (projectedEndBalance !== null && projectedEndBalance < 0);
    const isMedium = !isHigh && riskLevel === 'medium';

    const buildFindings = (lang: InsightLang): InsightFinding[] => {
      const t = i18n[lang];
      if (isHigh) {
        return [{
          severity: 'critical',
          title: t.cashFlowRiskTitle,
          body: t.cashFlowRiskBody(balanceStr),
        }];
      }
      if (isMedium) {
        return [{
          severity: 'warning',
          title: t.monthUnderPressureTitle,
          body: t.monthUnderPressureBody(balanceStr),
        }];
      }
      return [{
        severity: 'info',
        title: t.monthOnTrackTitle,
        body: t.monthOnTrackBody(balanceStr),
      }];
    };

    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'month-end-risk', todayStr, buildFindings('en'), undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'month-end-risk', todayStr, buildFindings('he'), undefined, 'he'),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'month-end-risk', todayStr, [{
        severity: 'warning',
        title: i18n.en.analysisUnavailableTitle,
        body: i18n.en.monthRiskUnavailableBody(msg),
      }], undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'month-end-risk', todayStr, [{
        severity: 'warning',
        title: i18n.he.analysisUnavailableTitle,
        body: i18n.he.monthRiskUnavailableBody(msg),
      }], undefined, 'he'),
    ]);
  }
}

// ---------------------------------------------------------------------------
// 4. Subscription Watch
// ---------------------------------------------------------------------------

export async function runSubscriptionWatch(user_id: string): Promise<void> {
  const todayStr = toDateStr(new Date());

  try {
    type PriceIncreaseRaw = {
      name: string;
      current: string;
      previous: string;
      changePct: string;
      meta: Record<string, unknown>;
    };
    type RenewalRaw = {
      description: string;
      amount: string;
      date: string;
      days: number;
      meta: Record<string, unknown>;
    };

    let priceIncreases: PriceIncreaseRaw[] = [];
    let subDataError: string | null = null;
    try {
      const { subscriptions } = await getSubscriptions(user_id);
      for (const sub of subscriptions) {
        if (sub.priceChangePct !== null && sub.priceChangePct >= PRICE_INCREASE_THRESHOLD_PCT) {
          priceIncreases.push({
            name: sub.name,
            current: fmt(sub.currentAmount),
            previous: fmt(sub.previousAmount ?? 0),
            changePct: Math.round(sub.priceChangePct).toString(),
            meta: {
              merchantKey: sub.merchantKey,
              currentAmount: sub.currentAmount,
              previousAmount: sub.previousAmount,
              priceChangePct: sub.priceChangePct,
            },
          });
        }
      }
    } catch (err: unknown) {
      subDataError = err instanceof Error ? err.message : String(err);
    }

    let renewals: RenewalRaw[] = [];
    try {
      const upcoming = await getUpcomingRenewals(user_id, 14);
      for (const renewal of upcoming) {
        if (renewal.daysUntil <= RENEWAL_ALERT_WITHIN_DAYS) {
          renewals.push({
            description: renewal.description,
            amount: fmt(renewal.amount),
            date: renewal.nextExpected,
            days: renewal.daysUntil,
            meta: {
              patternId: renewal.patternId,
              merchantKey: renewal.merchantKey,
              amount: renewal.amount,
              nextExpected: renewal.nextExpected,
              daysUntil: renewal.daysUntil,
            },
          });
        }
      }
    } catch {
      // renewals stays empty on failure
    }

    const buildFindings = (lang: InsightLang): InsightFinding[] => {
      const t = i18n[lang];
      const findings: InsightFinding[] = [];

      if (subDataError !== null) {
        findings.push({
          severity: 'warning',
          title: t.subDataUnavailableTitle,
          body: t.subDataUnavailableBody(subDataError),
        });
      } else {
        for (const pi of priceIncreases) {
          findings.push({
            severity: 'warning',
            title: t.priceIncreaseTitle(pi.name),
            body: t.priceIncreaseBody(pi.current, pi.previous, pi.changePct),
            meta: pi.meta,
          });
        }
      }

      for (const r of renewals) {
        findings.push({
          severity: 'info',
          title: t.upcomingRenewalTitle(r.description),
          body: t.upcomingRenewalBody(r.amount, r.date, r.days),
          meta: r.meta,
        });
      }

      if (findings.length === 0) {
        findings.push({
          severity: 'info',
          title: t.subscriptionsStableTitle,
          body: t.subscriptionsStableBody,
        });
      }

      return findings;
    };

    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'subscription-watch', todayStr, buildFindings('en'), undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'subscription-watch', todayStr, buildFindings('he'), undefined, 'he'),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'subscription-watch', todayStr, [{
        severity: 'warning',
        title: i18n.en.analysisUnavailableTitle,
        body: i18n.en.subscriptionUnavailableBody(msg),
      }], undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'subscription-watch', todayStr, [{
        severity: 'warning',
        title: i18n.he.analysisUnavailableTitle,
        body: i18n.he.subscriptionUnavailableBody(msg),
      }], undefined, 'he'),
    ]);
  }
}

// ---------------------------------------------------------------------------
// 5. Income Detection
// ---------------------------------------------------------------------------

export async function runIncomeDetection(user_id: string): Promise<void> {
  const now = new Date();
  const todayStr = toDateStr(now);

  if (now.getDate() > INCOME_SKIP_DAY) {
    return;
  }

  try {
    const currentMonthStart = monthBounds(now).start;
    const priorMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const priorBounds = monthBounds(priorMonthDate);

    const [currentBankTxns, priorBankTxns] = await Promise.all([
      fetchBankTxns(user_id, currentMonthStart, todayStr),
      fetchBankTxns(user_id, priorBounds.start, priorBounds.end),
    ]);

    const currentIncome = sumIncome(currentBankTxns);
    const priorIncome = sumIncome(priorBankTxns);
    const hasNoneThisMonth = priorIncome > INCOME_PRIOR_MIN && currentIncome === 0;

    let change = 0;
    let isIncomeUp = false;
    let isIncomeDown = false;
    if (currentIncome > 0 && priorIncome > 0) {
      change = ((currentIncome - priorIncome) / priorIncome) * 100;
      isIncomeUp = change > INCOME_CHANGE_THRESHOLD_PCT;
      isIncomeDown = change < -INCOME_CHANGE_THRESHOLD_PCT;
    }

    const buildFindings = (lang: InsightLang): InsightFinding[] => {
      const t = i18n[lang];
      const findings: InsightFinding[] = [];
      findings.push({
        severity: 'info',
        title: t.incomeThisMonthTitle,
        body: t.incomeThisMonthBody(fmt(currentIncome)),
      });
      if (hasNoneThisMonth) {
        findings.push({
          severity: 'warning',
          title: t.noIncomeTitle,
          body: t.noIncomeBody,
        });
      } else if (isIncomeUp) {
        findings.push({
          severity: 'info',
          title: t.incomeUpTitle,
          body: t.incomeUpBody(fmt(currentIncome), fmt(priorIncome), pct(change)),
        });
      } else if (isIncomeDown) {
        findings.push({
          severity: 'warning',
          title: t.incomeDownTitle,
          body: t.incomeDownBody(fmt(currentIncome), fmt(priorIncome), pct(change)),
        });
      }
      return findings;
    };

    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'income-detection', todayStr, buildFindings('en'), undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'income-detection', todayStr, buildFindings('he'), undefined, 'he'),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'income-detection', todayStr, [{
        severity: 'warning',
        title: i18n.en.analysisUnavailableTitle,
        body: i18n.en.incomeUnavailableBody(msg),
      }], undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'income-detection', todayStr, [{
        severity: 'warning',
        title: i18n.he.analysisUnavailableTitle,
        body: i18n.he.incomeUnavailableBody(msg),
      }], undefined, 'he'),
    ]);
  }
}

// ---------------------------------------------------------------------------
// 6. Anomaly Detection
// ---------------------------------------------------------------------------

type MerchantSpendMap = Map<string, number>;

const buildMerchantSpendMap = (txns: RawTxn[]): MerchantSpendMap => {
  const result = new Map<string, number>();
  for (const t of txns) {
    const amount = getTransactionAmount(t);
    if (amount >= 0) continue;
    const merchant = normalize(getTransactionTextSource(t));
    if (!merchant) continue;
    result.set(merchant, (result.get(merchant) ?? 0) + Math.abs(amount));
  }
  return result;
};

/** Build a deduplicated spend map using settlement filtering. */
const buildDeduplicatedSpendMap = (regularTxns: unknown[], cardTxns: unknown[]): MerchantSpendMap => {
  const treatments = buildSettlementTreatmentMap(regularTxns, cardTxns);
  const hasCardData = cardTxns.length > 0;
  const dataQuality = { lowConfidenceSettlementCount: 0, lowConfidenceSettlementSpend: 0 };
  const kept = filterAndTallySettlements(
    [...regularTxns, ...cardTxns],
    treatments,
    hasCardData,
    {
      id: (t: unknown) => (t as { _id?: { toString?: () => string } })._id?.toString?.() ?? '',
      text: (t: unknown) => getTransactionTextSource(t as Parameters<typeof getTransactionTextSource>[0]),
      amount: (t: unknown) => getTransactionAmount(t as Parameters<typeof getTransactionAmount>[0]),
    },
    dataQuality,
  );
  return buildMerchantSpendMap(kept as RawTxn[]);
};

type DuplicateCandidate = {
  merchant: string;
  amount: number;
  count: number;
  windowHours: number;
};

const detectDuplicateCharges = (txns: RawTxn[]): DuplicateCandidate[] => {
  const byMerchant = new Map<string, RawTxn[]>();
  for (const t of txns) {
    const amount = getTransactionAmount(t);
    if (amount >= 0) continue;
    const merchant = normalize(getTransactionTextSource(t));
    if (!merchant) continue;
    const list = byMerchant.get(merchant) ?? [];
    list.push(t);
    byMerchant.set(merchant, list);
  }

  const duplicates: DuplicateCandidate[] = [];
  const windowMs = DUPLICATE_WINDOW_HOURS * 3600 * 1000;

  for (const [merchant, group] of byMerchant.entries()) {
    if (group.length < DUPLICATE_MIN_OCCURRENCES) continue;

    // Sort by event date ascending
    const sorted = group.slice().sort((a, b) =>
      getEventDate(a).localeCompare(getEventDate(b)),
    );

    // Sliding window: check each pair within 48 hours with similar amounts
    for (let i = 0; i < sorted.length; i++) {
      const base = sorted[i];
      const baseAmount = Math.abs(getTransactionAmount(base));
      const baseTime = new Date(getEventDate(base)).getTime();

      const matches: RawTxn[] = [base];
      for (let j = i + 1; j < sorted.length; j++) {
        const candidate = sorted[j];
        const candidateTime = new Date(getEventDate(candidate)).getTime();
        if (candidateTime - baseTime > windowMs) break;

        const candidateAmount = Math.abs(getTransactionAmount(candidate));
        if (baseAmount > 0) {
          const diff = Math.abs(candidateAmount - baseAmount) / baseAmount;
          if (diff <= DUPLICATE_AMOUNT_TOLERANCE) {
            matches.push(candidate);
          }
        }
      }

      if (matches.length >= DUPLICATE_MIN_OCCURRENCES) {
        const actualWindowHours = matches.length > 1
          ? Math.round(
              (new Date(getEventDate(matches[matches.length - 1])).getTime() - baseTime) / 3600000,
            )
          : 0;
        duplicates.push({
          merchant,
          amount: baseAmount,
          count: matches.length,
          windowHours: actualWindowHours || 1,
        });
        break; // one flag per merchant
      }
    }
  }

  return duplicates;
};

export async function runAnomalyDetection(user_id: string): Promise<void> {
  const now = new Date();
  const todayStr = toDateStr(now);

  try {
    const current = monthBounds(now);
    const historyStart = monthBounds(
      new Date(now.getFullYear(), now.getMonth() - ANOMALY_LOOKBACK_MONTHS, 1),
    ).start;
    const historyEnd = monthBounds(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    ).end;

    const [currentData, historyData] = await Promise.all([
      fetchCompletedTransactions(user_id, { eventDate: { $gte: current.start, $lte: todayStr } }),
      fetchCompletedTransactions(user_id, { eventDate: { $gte: historyStart, $lte: historyEnd } }),
    ]);

    const currentSpend = buildDeduplicatedSpendMap(currentData.regularTxns, currentData.cardTxns);
    const historySpend = buildDeduplicatedSpendMap(historyData.regularTxns, historyData.cardTxns);

    const anomalies = Array.from(currentSpend.entries())
      .map(([merchant, spent]) => {
        const baseline = (historySpend.get(merchant) ?? 0) / ANOMALY_LOOKBACK_MONTHS;
        return { merchant, spent, baseline, delta: spent - baseline };
      })
      .filter(
        (a) => a.baseline > 0 && a.spent >= a.baseline * ANOMALY_RATIO && a.delta >= ANOMALY_MIN_DELTA,
      )
      .sort((a, b) => b.delta - a.delta)
      .slice(0, ANOMALY_MAX_FLAGS);

    const currentAllTxns = [...currentData.regularTxns, ...currentData.cardTxns] as RawTxn[];
    const duplicates = detectDuplicateCharges(currentAllTxns);

    const buildFindings = (lang: InsightLang): InsightFinding[] => {
      const t = i18n[lang];
      const findings: InsightFinding[] = [];

      for (const anomaly of anomalies) {
        findings.push({
          severity: 'warning',
          title: t.unusualSpendTitle(anomaly.merchant),
          body: t.unusualSpendBody(fmt(anomaly.spent), fmt(anomaly.baseline)),
          meta: {
            merchant: anomaly.merchant,
            spent: Math.round(anomaly.spent),
            baseline: Math.round(anomaly.baseline),
            delta: Math.round(anomaly.delta),
          },
        });
      }

      for (const dup of duplicates) {
        findings.push({
          severity: 'warning',
          title: t.duplicateChargeTitle(dup.merchant),
          body: t.duplicateChargeBody(fmt(dup.amount), dup.count),
          meta: {
            merchant: dup.merchant,
            amount: dup.amount,
            count: dup.count,
            windowHours: dup.windowHours,
          },
        });
      }

      if (findings.length === 0) {
        findings.push({
          severity: 'info',
          title: t.noAnomaliesTitle,
          body: t.noAnomaliesBody,
        });
      }

      return findings;
    };

    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'anomaly-detection', todayStr, buildFindings('en'), undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'anomaly-detection', todayStr, buildFindings('he'), undefined, 'he'),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'anomaly-detection', todayStr, [{
        severity: 'warning',
        title: i18n.en.analysisUnavailableTitle,
        body: i18n.en.anomalyUnavailableBody(msg),
      }], undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'anomaly-detection', todayStr, [{
        severity: 'warning',
        title: i18n.he.analysisUnavailableTitle,
        body: i18n.he.anomalyUnavailableBody(msg),
      }], undefined, 'he'),
    ]);
  }
}
