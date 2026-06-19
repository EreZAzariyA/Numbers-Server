import { Transactions, CardTransactions } from '../collections';
import { getPatterns } from './recurring/pattern-service';
import { IRecurringPatternModel } from '../models/recurring-pattern-model';
import { Frequency } from '../utils/types';
import { getEventDate, getTransactionAmount } from '../utils/transaction-semantics';
import { round2 } from '../utils/money';
import { toDateStr, diffDays } from '../utils/date-helpers';

// Classes we treat as "subscriptions" for this view: recurring sign-ups and fixed bills.
const SUBSCRIPTION_CLASSES = new Set(['subscription', 'fixed_expense']);
// Price is flagged as increased only when the latest charge is at least this much
// above the previous one — small drifts (FX, rounding) should not raise a flag.
const PRICE_INCREASE_THRESHOLD_PCT = 10;
// A subscription with no charge for this many expected cycles is considered stale.
const STALE_CYCLE_MULTIPLIER = 2;

const FREQUENCY_TO_MONTHLY_FACTOR: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  bimonthly: 1 / 2,
  quarterly: 1 / 3,
  semiannual: 1 / 6,
  annual: 1 / 12,
};

const FREQUENCY_TO_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  bimonthly: 60,
  quarterly: 91,
  semiannual: 182,
  annual: 365,
};

export interface SubscriptionSummary {
  patternId: string;
  merchantKey: string;
  name: string;
  frequency: Frequency;
  currentAmount: number;
  previousAmount: number | null;
  priceChangePct: number | null;
  monthlyEquivalent: number;
  lastSeen: string;
  nextExpected: string | null;
  isStale: boolean;
}

export interface SubscriptionsResponse {
  subscriptions: SubscriptionSummary[];
  monthlyTotal: number;
  priceIncreaseCount: number;
  staleCount: number;
}

const effectiveFrequency = (pattern: IRecurringPatternModel): string =>
  pattern.userOverride?.customFrequency ?? pattern.frequency;

const readableName = (pattern: IRecurringPatternModel): string =>
  pattern.signals?.descriptionVariants?.[0] ?? pattern.merchantKey;

// Fetch the amounts of a pattern's recorded occurrences, sorted oldest→newest,
// so we can compare the latest charge against the one before it.
const getOccurrenceAmounts = async (occurrenceTxIds: string[]): Promise<number[]> => {
  if (!occurrenceTxIds.length) return [];

  const [regular, card] = await Promise.all([
    Transactions.find({ _id: { $in: occurrenceTxIds } }).lean().exec(),
    CardTransactions.find({ _id: { $in: occurrenceTxIds } }).lean().exec(),
  ]);

  return [...regular, ...card]
    .sort((a, b) => getEventDate(a).localeCompare(getEventDate(b)))
    .map((t) => Math.abs(getTransactionAmount(t)));
};

const computeMonthlyEquivalent = (amount: number, frequency: string): number => {
  const factor = FREQUENCY_TO_MONTHLY_FACTOR[frequency] ?? 1;
  return round2(amount * factor);
};

const computeIsStale = (lastSeen: string, frequency: string, today: string): boolean => {
  if (!lastSeen) return false;
  const cycleDays = FREQUENCY_TO_DAYS[frequency];
  if (!cycleDays) return false;
  return diffDays(lastSeen, today) > cycleDays * STALE_CYCLE_MULTIPLIER;
};

const toSubscription = async (
  pattern: IRecurringPatternModel,
  today: string,
): Promise<SubscriptionSummary> => {
  const frequency = effectiveFrequency(pattern);
  const amounts = await getOccurrenceAmounts(pattern.observed?.occurrenceTxIds ?? []);

  const currentAmount = amounts.length
    ? amounts[amounts.length - 1]
    : Math.abs(pattern.userOverride?.customAmount ?? pattern.amount?.median ?? 0);
  const previousAmount = amounts.length >= 2 ? amounts[amounts.length - 2] : null;

  const priceChangePct = previousAmount && previousAmount > 0
    ? round2(((currentAmount - previousAmount) / previousAmount) * 100)
    : null;

  return {
    patternId: pattern._id?.toString() ?? '',
    merchantKey: pattern.merchantKey,
    name: readableName(pattern),
    frequency: frequency as Frequency,
    currentAmount: round2(currentAmount),
    previousAmount: previousAmount !== null ? round2(previousAmount) : null,
    priceChangePct,
    monthlyEquivalent: computeMonthlyEquivalent(currentAmount, frequency),
    lastSeen: pattern.observed?.lastSeen ?? '',
    nextExpected: null,
    isStale: computeIsStale(pattern.observed?.lastSeen ?? '', frequency, today),
  };
};

export const getSubscriptions = async (user_id: string): Promise<SubscriptionsResponse> => {
  const patterns = await getPatterns(user_id);
  const today = toDateStr(new Date());

  const subscriptionPatterns = patterns.filter((pattern) => {
    if (pattern.kind !== 'expense') return false;
    if (pattern.userOverride?.disabled) return false;
    const classification = pattern.userOverride?.customClassification ?? pattern.classification;
    return SUBSCRIPTION_CLASSES.has(classification);
  });

  const subscriptions = await Promise.all(
    subscriptionPatterns.map((pattern) => toSubscription(pattern, today)),
  );

  subscriptions.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);

  const monthlyTotal = round2(
    subscriptions.filter((s) => !s.isStale).reduce((sum, s) => sum + s.monthlyEquivalent, 0),
  );
  const priceIncreaseCount = subscriptions.filter(
    (s) => s.priceChangePct !== null && s.priceChangePct >= PRICE_INCREASE_THRESHOLD_PCT,
  ).length;
  const staleCount = subscriptions.filter((s) => s.isStale).length;

  return { subscriptions, monthlyTotal, priceIncreaseCount, staleCount };
};

export { PRICE_INCREASE_THRESHOLD_PCT };
