import { PatternClass, RecurringGroup, UpcomingRenewal } from '../../utils/types';
import { detectRecurringTransactions } from '../transactions';
import { addDays, diffDays, toDateStr } from '../../utils/date-helpers';

// "Renewals" are recurring outflows the user signed up for — subscriptions and
// fixed bills — as opposed to noisy variable spend.
const RENEWAL_CLASSES: PatternClass[] = ['subscription', 'fixed_expense'];
export const DEFAULT_RENEWAL_WINDOW_DAYS = 7;
const MAX_RENEWAL_WINDOW_DAYS = 60;
const MIN_RENEWAL_CONFIDENCE = 0.5;

const clampWindow = (withinDays: number): number => {
  const value = Math.floor(withinDays);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_RENEWAL_WINDOW_DAYS;
  return Math.min(value, MAX_RENEWAL_WINDOW_DAYS);
};

const isRenewalGroup = (group: RecurringGroup): boolean => {
  if (group.kind !== 'expense') return false;
  if (!RENEWAL_CLASSES.includes((group.classification ?? 'variable_expense') as PatternClass)) return false;
  return Boolean(group.userOverride?.confirmed) || (group.confidence ?? 0) >= MIN_RENEWAL_CONFIDENCE;
};

const toRenewal = (group: RecurringGroup, today: string): UpcomingRenewal => ({
  patternId: group.patternId,
  description: group.description,
  amount: Math.abs(group.amount),
  nextExpected: group.nextExpected as string,
  daysUntil: diffDays(today, group.nextExpected as string),
  frequency: group.frequency,
  classification: (group.classification ?? 'fixed_expense') as PatternClass,
  confidence: group.confidence ?? 0,
  source: group.source ?? 'bank',
  merchantKey: group.merchantKey,
});

/**
 * Upcoming subscription/fixed-bill renewals due within `withinDays` (default 7).
 * Built on the cached recurring-pattern detection, which already refreshes
 * `nextExpected` to the next future occurrence.
 */
export const getUpcomingRenewals = async (
  user_id: string,
  withinDays: number = DEFAULT_RENEWAL_WINDOW_DAYS,
): Promise<UpcomingRenewal[]> => {
  const window = clampWindow(withinDays);
  const today = toDateStr(new Date());
  const horizon = addDays(today, window);

  const groups = await detectRecurringTransactions(user_id, { dateBasis: 'event' });

  return groups
    .filter(isRenewalGroup)
    .filter((group) => Boolean(group.nextExpected) && group.nextExpected! >= today && group.nextExpected! <= horizon)
    .map((group) => toRenewal(group, today))
    .sort((left, right) => left.nextExpected.localeCompare(right.nextExpected));
};
