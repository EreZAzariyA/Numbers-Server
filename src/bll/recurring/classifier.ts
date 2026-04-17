import { PatternClass, Frequency } from '../../utils/types';
import { IRecurringPatternModel } from '../../models/recurring-pattern-model';

/**
 * Rule-based classifier for recurring patterns. First-match wins.
 *
 * Takes a partial pattern (post-frequency/amount computation) and returns
 * the best-fit classification.
 */

type ClassifyInput = Pick<IRecurringPatternModel,
  'kind' | 'frequency' | 'stability'
> & {
  amountStability: number; // 1 - (stddev / mean), clamped 0..1
  installmentTotal?: number;
  channel?: string;
  occurrences: number;
  categoryDescription?: string;
};

const SALARY_KEYWORDS = ['salary', 'wage', 'payroll', 'משכורת', 'שכר'];

const isOnlineChannel = (ch?: string): boolean => {
  if (!ch) return false;
  const lower = ch.toLowerCase();
  return lower.includes('online') || lower.includes('digital') || lower.includes('internet');
};

export const classify = (input: ClassifyInput): PatternClass => {
  // 1. Installment plan
  if (input.installmentTotal && input.installmentTotal > 1) {
    return 'installment_plan';
  }

  // 2. Fixed income (salary-like)
  if (
    input.kind === 'income' &&
    input.stability >= 0.85 &&
    input.frequency === 'monthly' &&
    (
      SALARY_KEYWORDS.some((kw) => (input.categoryDescription ?? '').toLowerCase().includes(kw)) ||
      input.occurrences >= 3
    )
  ) {
    return 'fixed_income';
  }

  // 3. Variable income
  if (input.kind === 'income' && input.stability > 0) {
    return 'variable_income';
  }

  // 4. Subscription (digital, consistent amount, recurring)
  if (
    input.kind === 'expense' &&
    isOnlineChannel(input.channel) &&
    input.amountStability >= 0.9 &&
    (input.frequency === 'monthly' || input.frequency === 'annual') &&
    input.occurrences >= 3
  ) {
    return 'subscription';
  }

  // 5. Fixed expense
  if (
    input.kind === 'expense' &&
    input.amountStability >= 0.85 &&
    input.frequency !== 'unknown'
  ) {
    return 'fixed_expense';
  }

  // 6. Variable expense (recurring but amount varies)
  if (
    input.kind === 'expense' &&
    input.frequency !== 'unknown' &&
    input.amountStability < 0.85
  ) {
    return 'variable_expense';
  }

  // 7. Default
  return 'one_time';
};
