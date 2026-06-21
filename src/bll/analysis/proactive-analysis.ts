import { InsightFinding } from '../../models';
import agentInsightsLogic from '../agent-insights';
import { calculateCashFlowProjection } from '../cash-flow-projection';
import { getSubscriptions } from '../subscriptions';
import { getUpcomingRenewals } from '../recurring/renewals';
import { fetchCompletedTransactions } from '../shared/transaction-queries';
import { filterAndTallySettlements } from '../shared/settlement-filter';
import { buildSettlementTreatmentMap } from '../../utils/settlement-detection';
import { getTransactionAmount, getTransactionTextSource, getEventDate } from '../../utils/transaction-semantics';
import { normalize } from '../recurring/normalization';
import { toDateStr, addDays, monthBounds } from '../../utils/date-helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGH_SPEND_RATIO = 2;
const HIGH_SPEND_MIN_TOTAL = 200;
const LARGE_TXN_THRESHOLD = 1000;
const WEEKLY_CHANGE_THRESHOLD_PCT = 20;
const PRICE_INCREASE_MIN_PCT = 8;
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
  const historyEnd = toDateStr(new Date(yesterdayDate.getTime() - 86400000)); // day before yesterday
  const historyStart = addDays(historyEnd, -29); // 30 days ending day-before-yesterday

  const [yesterdayTxns, historyTxns] = await Promise.all([
    fetchAllTxns(user_id, yesterdayStr, yesterdayStr),
    fetchAllTxns(user_id, historyStart, historyEnd),
  ]);

  const yesterdayTotal = sumExpenses(yesterdayTxns);
  const historyTotal = sumExpenses(historyTxns);
  const dailyAverage = historyTotal / 30;

  const findings: InsightFinding[] = [];

  findings.push({
    severity: 'info',
    title: 'Daily spending summary',
    body: `Spent ₪${fmt(yesterdayTotal)} yesterday (30-day daily average: ₪${fmt(dailyAverage)}).`,
  });

  if (yesterdayTotal > HIGH_SPEND_RATIO * dailyAverage && yesterdayTotal > HIGH_SPEND_MIN_TOTAL) {
    const overPct = dailyAverage > 0
      ? Math.round(((yesterdayTotal - dailyAverage) / dailyAverage) * 100)
      : 0;
    findings.push({
      severity: 'warning',
      title: 'Higher than usual day',
      body: `Yesterday's spend was ${overPct}% above your daily average.`,
    });
  }

  for (const t of yesterdayTxns) {
    const amount = getTransactionAmount(t);
    if (Math.abs(amount) >= LARGE_TXN_THRESHOLD) {
      const description = getTransactionTextSource(t);
      findings.push({
        severity: 'info',
        title: 'Large transaction',
        body: `${description}: ₪${fmt(Math.abs(amount))}`,
        meta: { description, amount },
      });
    }
  }

  await agentInsightsLogic.upsert(user_id, 'daily-expense-review', yesterdayStr, findings);
}

// ---------------------------------------------------------------------------
// 2. Weekly Summary
// ---------------------------------------------------------------------------

export async function runWeeklySummary(user_id: string): Promise<void> {
  const todayStr = toDateStr(new Date());
  const thisWeekStart = addDays(todayStr, -6);  // last 7 days ending today
  const lastWeekEnd = addDays(todayStr, -7);    // day before this week started
  const lastWeekStart = addDays(todayStr, -13); // 7 days ending lastWeekEnd

  const [thisWeekTxns, lastWeekTxns] = await Promise.all([
    fetchAllTxns(user_id, thisWeekStart, todayStr),
    fetchAllTxns(user_id, lastWeekStart, lastWeekEnd),
  ]);

  const thisWeekTotal = sumExpenses(thisWeekTxns);
  const lastWeekTotal = sumExpenses(lastWeekTxns);

  const findings: InsightFinding[] = [];

  let deltaLabel = '0%';
  let deltaNum = 0;
  if (lastWeekTotal > 0) {
    deltaNum = ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100;
    const sign = deltaNum >= 0 ? '+' : '-';
    deltaLabel = `${sign}${pct(deltaNum)}%`;
  }

  findings.push({
    severity: 'info',
    title: 'Weekly spending',
    body: `This week: ₪${fmt(thisWeekTotal)} vs last week: ₪${fmt(lastWeekTotal)} (${deltaLabel}).`,
  });

  if (deltaNum > WEEKLY_CHANGE_THRESHOLD_PCT) {
    findings.push({
      severity: 'warning',
      title: 'Spending up this week',
      body: `This week's spending is ${pct(deltaNum)}% higher than last week (₪${fmt(thisWeekTotal)} vs ₪${fmt(lastWeekTotal)}).`,
    });
  } else if (deltaNum < -WEEKLY_CHANGE_THRESHOLD_PCT) {
    findings.push({
      severity: 'info',
      title: 'Spending down this week',
      body: `This week's spending is ${pct(deltaNum)}% lower than last week (₪${fmt(thisWeekTotal)} vs ₪${fmt(lastWeekTotal)}).`,
    });
  }

  await agentInsightsLogic.upsert(user_id, 'weekly-summary', todayStr, findings);
}

// ---------------------------------------------------------------------------
// 3. Month-End Risk
// ---------------------------------------------------------------------------

export async function runMonthEndRisk(user_id: string): Promise<void> {
  const todayStr = toDateStr(new Date());
  const projection = await calculateCashFlowProjection(user_id);
  const { riskLevel, projectedEndBalance } = projection;

  const balanceStr = projectedEndBalance !== null ? `₪${fmt(projectedEndBalance)}` : 'unknown';
  const findings: InsightFinding[] = [];

  if (riskLevel === 'high' || (projectedEndBalance !== null && projectedEndBalance < 0)) {
    findings.push({
      severity: 'critical',
      title: 'Cash flow risk',
      body: `Projected month-end balance: ${balanceStr}. Risk level: high.`,
    });
  } else if (riskLevel === 'medium') {
    findings.push({
      severity: 'warning',
      title: 'Month-end under pressure',
      body: `Projected balance: ${balanceStr}. Watch spending this week.`,
    });
  } else {
    findings.push({
      severity: 'info',
      title: 'Month on track',
      body: `Projected month-end balance: ${balanceStr}.`,
    });
  }

  await agentInsightsLogic.upsert(user_id, 'month-end-risk', todayStr, findings);
}

// ---------------------------------------------------------------------------
// 4. Subscription Watch
// ---------------------------------------------------------------------------

export async function runSubscriptionWatch(user_id: string): Promise<void> {
  const todayStr = toDateStr(new Date());

  const [{ subscriptions }, renewals] = await Promise.all([
    getSubscriptions(user_id),
    getUpcomingRenewals(user_id, 14),
  ]);

  const findings: InsightFinding[] = [];

  for (const sub of subscriptions) {
    if (sub.priceChangePct !== null && sub.priceChangePct >= PRICE_INCREASE_MIN_PCT) {
      findings.push({
        severity: 'warning',
        title: `Price increase: ${sub.name}`,
        body: `Now ₪${fmt(sub.currentAmount)} (was ₪${fmt(sub.previousAmount ?? 0)}, +${Math.round(sub.priceChangePct)}%).`,
        meta: {
          merchantKey: sub.merchantKey,
          currentAmount: sub.currentAmount,
          previousAmount: sub.previousAmount,
          priceChangePct: sub.priceChangePct,
        },
      });
    }
  }

  for (const renewal of renewals) {
    if (renewal.daysUntil <= RENEWAL_ALERT_WITHIN_DAYS) {
      findings.push({
        severity: 'info',
        title: `Upcoming renewal: ${renewal.description}`,
        body: `₪${fmt(renewal.amount)} expected on ${renewal.nextExpected} (in ${renewal.daysUntil} day(s)).`,
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

  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      title: 'Subscriptions stable',
      body: 'No significant subscription changes detected.',
    });
  }

  await agentInsightsLogic.upsert(user_id, 'subscription-watch', todayStr, findings);
}

// ---------------------------------------------------------------------------
// 5. Income Detection
// ---------------------------------------------------------------------------

export async function runIncomeDetection(user_id: string): Promise<void> {
  const now = new Date();
  const todayStr = toDateStr(now);

  if (now.getDate() > INCOME_SKIP_DAY) {
    await agentInsightsLogic.upsert(user_id, 'income-detection', todayStr, [{
      severity: 'info',
      title: 'Income check skipped',
      body: 'Runs in the first 12 days of each month.',
    }]);
    return;
  }

  const currentMonthStart = monthBounds(now).start;

  const priorMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const priorBounds = monthBounds(priorMonthDate);

  const [currentBankTxns, priorBankTxns] = await Promise.all([
    fetchBankTxns(user_id, currentMonthStart, todayStr),
    fetchBankTxns(user_id, priorBounds.start, priorBounds.end),
  ]);

  const currentIncome = sumIncome(currentBankTxns);
  const priorIncome = sumIncome(priorBankTxns);

  const findings: InsightFinding[] = [];

  findings.push({
    severity: 'info',
    title: 'Income this month',
    body: `Received ₪${fmt(currentIncome)} in income so far this month.`,
  });

  if (priorIncome > INCOME_PRIOR_MIN && currentIncome === 0) {
    findings.push({
      severity: 'warning',
      title: 'No income detected',
      body: 'You had income last month but none detected yet this month.',
    });
  } else if (currentIncome > 0 && priorIncome > 0) {
    const change = ((currentIncome - priorIncome) / priorIncome) * 100;
    if (change > INCOME_CHANGE_THRESHOLD_PCT) {
      findings.push({
        severity: 'info',
        title: 'Income up',
        body: `Income ₪${fmt(currentIncome)} this month vs ₪${fmt(priorIncome)} last month (+${pct(change)}%).`,
      });
    } else if (change < -INCOME_CHANGE_THRESHOLD_PCT) {
      findings.push({
        severity: 'warning',
        title: 'Income down',
        body: `Income ₪${fmt(currentIncome)} this month vs ₪${fmt(priorIncome)} last month (-${pct(change)}%).`,
      });
    }
  }

  await agentInsightsLogic.upsert(user_id, 'income-detection', todayStr, findings);
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
  const current = monthBounds(now);
  const historyStart = monthBounds(new Date(now.getFullYear(), now.getMonth() - ANOMALY_LOOKBACK_MONTHS, 1)).start;
  const historyEnd = monthBounds(new Date(now.getFullYear(), now.getMonth() - 1, 1)).end;

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
    .filter((a) => a.baseline > 0 && a.spent >= a.baseline * ANOMALY_RATIO && a.delta >= ANOMALY_MIN_DELTA)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, ANOMALY_MAX_FLAGS);

  const currentAllTxns = [...currentData.regularTxns, ...currentData.cardTxns] as RawTxn[];
  const duplicates = detectDuplicateCharges(currentAllTxns);

  const findings: InsightFinding[] = [];

  for (const anomaly of anomalies) {
    findings.push({
      severity: 'warning',
      title: `Unusual spend at ${anomaly.merchant}`,
      body: `₪${fmt(anomaly.spent)} this month vs a ₪${fmt(anomaly.baseline)} monthly average.`,
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
      title: `Possible duplicate charge at ${dup.merchant}`,
      body: `₪${fmt(dup.amount)} appears ${dup.count} times within ${dup.windowHours} hour(s).`,
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
      title: 'No anomalies detected',
      body: 'Spending looks normal this month.',
    });
  }

  await agentInsightsLogic.upsert(user_id, 'anomaly-detection', todayStr, findings);
}
