import { Categories } from '../collections';
import cacheService from '../utils/cache-service';
import { buildSettlementTreatmentMap } from '../utils/settlement-detection';
import { getTransactionAmount, getTransactionTextSource } from '../utils/transaction-semantics';
import { monthBounds, toDateStr, addDays } from '../utils/date-helpers';
import { round2 } from '../utils/money';
import { fetchCompletedTransactions } from './shared/transaction-queries';
import { filterAndTallySettlements } from './shared/settlement-filter';

const CACHE_TTL_SECONDS = 300;
const DEFAULT_TOP_CHANGES = 6;
const UNCATEGORIZED = 'Uncategorized';

interface PeriodWindow {
  start: string;
  end: string;
}

interface PeriodSpend {
  start: string;
  end: string;
  total: number;
}

export interface CategoryChange {
  category: string;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
}

export interface SpendingComparisonResponse {
  current: PeriodSpend;
  previous: PeriodSpend;
  totalDelta: number;
  totalDeltaPct: number | null;
  topCategoryChanges: CategoryChange[];
}

interface CategorizedExpense {
  amount: number;       // absolute spend
  category_id: string;
}

const buildCategoryNameMap = async (user_id: string): Promise<Map<string, string>> => {
  const doc = await Categories.findOne({ user_id }).lean().exec();
  const categories = (doc as { categories?: { _id?: unknown; name?: string }[] } | null)?.categories ?? [];
  const map = new Map<string, string>();
  for (const category of categories) {
    if (category._id) map.set(String(category._id), category.name ?? UNCATEGORIZED);
  }
  return map;
};

// Settlement-safe expense aggregation for one date window, mirroring the path in
// financial-health.ts so credit-card settlement rows are not double-counted.
const getExpensesInWindow = async (user_id: string, window: PeriodWindow): Promise<CategorizedExpense[]> => {
  const { regularTxns, cardTxns } = await fetchCompletedTransactions(user_id, {
    eventDate: { $gte: window.start, $lte: window.end },
  });

  const hasCardData = cardTxns.length > 0;
  const treatments = buildSettlementTreatmentMap(regularTxns, cardTxns);
  const dataQuality = { lowConfidenceSettlementCount: 0, lowConfidenceSettlementSpend: 0 };

  return filterAndTallySettlements(
    [...regularTxns, ...cardTxns],
    treatments,
    hasCardData,
    {
      id: (t: unknown) => (t as { _id?: { toString?: () => string } })._id?.toString?.() ?? '',
      text: (t: unknown) => getTransactionTextSource(t as Parameters<typeof getTransactionTextSource>[0]),
      amount: (t: unknown) => getTransactionAmount(t as Parameters<typeof getTransactionAmount>[0]),
    },
    dataQuality,
  )
    .map((t: unknown) => ({
      amount: getTransactionAmount(t as Parameters<typeof getTransactionAmount>[0]),
      category_id: (t as { category_id?: { toString?: () => string } }).category_id?.toString?.() ?? '',
    }))
    .filter((entry) => entry.amount < 0)
    .map((entry) => ({ amount: Math.abs(entry.amount), category_id: entry.category_id }));
};

const totalsByCategory = (entries: CategorizedExpense[]): Map<string, number> => {
  const result = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.category_id || UNCATEGORIZED;
    result.set(key, (result.get(key) ?? 0) + entry.amount);
  }
  return result;
};

export const compareSpendingPeriods = async (
  user_id: string,
  force = false,
): Promise<SpendingComparisonResponse> => {
  const cacheKey = `spendingComparison:${user_id}`;
  if (!force) {
    const cached = await cacheService.get<SpendingComparisonResponse>(cacheKey);
    if (cached) return cached;
  }

  const now = new Date();
  const today = toDateStr(now);
  const dayOfMonth = now.getDate();

  const currentBounds = monthBounds(now);
  const currentWindow: PeriodWindow = { start: currentBounds.start, end: today };

  // Fair month-to-date comparison: same span (1st → same day-of-month) last month.
  const prevBounds = monthBounds(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const prevSpanEnd = addDays(prevBounds.start, dayOfMonth - 1);
  const previousWindow: PeriodWindow = {
    start: prevBounds.start,
    end: prevSpanEnd < prevBounds.end ? prevSpanEnd : prevBounds.end,
  };

  const [currentExpenses, previousExpenses, categoryNames] = await Promise.all([
    getExpensesInWindow(user_id, currentWindow),
    getExpensesInWindow(user_id, previousWindow),
    buildCategoryNameMap(user_id),
  ]);

  const currentTotal = round2(currentExpenses.reduce((sum, e) => sum + e.amount, 0));
  const previousTotal = round2(previousExpenses.reduce((sum, e) => sum + e.amount, 0));

  const currentByCategory = totalsByCategory(currentExpenses);
  const previousByCategory = totalsByCategory(previousExpenses);
  const keys = new Set([...currentByCategory.keys(), ...previousByCategory.keys()]);

  const topCategoryChanges: CategoryChange[] = Array.from(keys)
    .map((key) => {
      const current = round2(currentByCategory.get(key) ?? 0);
      const previous = round2(previousByCategory.get(key) ?? 0);
      const delta = round2(current - previous);
      return {
        category: key === UNCATEGORIZED ? UNCATEGORIZED : categoryNames.get(key) ?? UNCATEGORIZED,
        current,
        previous,
        delta,
        deltaPct: previous > 0 ? round2((delta / previous) * 100) : null,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, DEFAULT_TOP_CHANGES);

  const totalDelta = round2(currentTotal - previousTotal);
  const response: SpendingComparisonResponse = {
    current: { ...currentWindow, total: currentTotal },
    previous: { ...previousWindow, total: previousTotal },
    totalDelta,
    totalDeltaPct: previousTotal > 0 ? round2((totalDelta / previousTotal) * 100) : null,
    topCategoryChanges,
  };

  await cacheService.set(cacheKey, response, CACHE_TTL_SECONDS);
  return response;
};
