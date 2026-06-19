import { ForecastResponse, MonthlySpend } from '../utils/types';
import cacheService from '../utils/cache-service';
import { buildForecastPrompt } from '../utils/ai-prompts';
import { generateUserInsight } from '../utils/ai-provider';
import { buildSettlementTreatmentMap } from '../utils/settlement-detection';
import { getEventDate, getTransactionAmount, getTransactionTextSource } from '../utils/transaction-semantics';
import { daysInMonth, monthBounds } from '../utils/date-helpers';
import { round2 } from '../utils/money';
import { fetchCompletedTransactions } from './shared/transaction-queries';
import { filterAndTallySettlements } from './shared/settlement-filter';

export const calculateForecast = async (
  user_id: string,
  language: string = 'en',
  includeInsight: boolean = true,
): Promise<ForecastResponse> => {
  const baseKey = `forecast:${user_id}:${language}`;
  const cacheKey = includeInsight ? baseKey : `${baseKey}:lite`;
  let cached = await cacheService.get<ForecastResponse>(cacheKey);
  if (!cached && !includeInsight) {
    // Reuse the dashboard's full (insight-bearing) cache when it is already warm.
    cached = await cacheService.get<ForecastResponse>(baseKey);
  }
  if (cached) return cached;

  const now = new Date();

  // Build since string — 7 months back (6 historical + current in-progress)
  // Critical: date field is stored as string "YYYY-MM-DD", use string comparison
  const since = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const sinceStr = since.toISOString().slice(0, 10);

  // Fetch from both collections (same pattern as detectRecurringTransactions)
  const { regularTxns, cardTxns } = await fetchCompletedTransactions(user_id, {
    eventDate: { $gte: sinceStr },
  });

  // Detect whether the user has granular card data — if so, bank-side
  // settlement rows (the monthly CC bill lump sum) are double-counting.
  const hasCardData = cardTxns.length > 0;
  const settlementTreatments = buildSettlementTreatmentMap(regularTxns, cardTxns);
  const dataQuality = {
    lowConfidenceSettlementCount: 0,
    lowConfidenceSettlementSpend: 0,
    hasGranularCardData: hasCardData,
  };

  // Normalize — keep only expenses (amount < 0), take absolute value.
  // Exclude credit-card settlement rows when granular card data exists.
  const expenses = [...regularTxns, ...cardTxns]
    .map((t: any) => ({
      id: t._id?.toString?.() ?? '',
      month: getEventDate(t).slice(0, 7),
      rawAmount: getTransactionAmount(t),
      description: getTransactionTextSource(t),
    }))
    .filter((t) => t.rawAmount < 0);

  const all = filterAndTallySettlements(
    expenses,
    settlementTreatments,
    hasCardData,
    { id: (t) => t.id, text: (t) => t.description, amount: (t) => t.rawAmount },
    dataQuality,
  ).map((t) => ({ month: t.month, amount: Math.abs(t.rawAmount) }));

  // Group by month
  const byMonth = new Map<string, number>();
  for (const t of all) {
    byMonth.set(t.month, (byMonth.get(t.month) ?? 0) + t.amount);
  }

  // Separate current month from historical
  const { monthStr: currentMonthStr } = monthBounds(now);
  const currentMonthSpend = byMonth.get(currentMonthStr) ?? 0;
  byMonth.delete(currentMonthStr);

  // Build sorted historical array (up to 6 most recent complete months)
  const historicalMonths: MonthlySpend[] = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([month, amount]) => ({ month, amount: round2(amount) }));

  // Average from historical
  const averageMonthlySpend = historicalMonths.length > 0
    ? historicalMonths.reduce((s, m) => s + m.amount, 0) / historicalMonths.length
    : 0;

  // Pro-rate forecast
  const totalDays = daysInMonth(now.getFullYear(), now.getMonth());
  const daysElapsed = now.getDate();
  const daysRemaining = totalDays - daysElapsed;

  const forecastAmount = daysElapsed > 0
    ? round2((currentMonthSpend / daysElapsed) * totalDays)
    : 0;

  // Trend
  let trend: 'up' | 'down' | 'flat' = 'flat';
  if (averageMonthlySpend > 0) {
    if (forecastAmount > averageMonthlySpend * 1.05) trend = 'up';
    else if (forecastAmount < averageMonthlySpend * 0.95) trend = 'down';
  }

  // AI insight — graceful degradation if key missing or call fails. Skipped when
  // the caller only needs the numbers (e.g. the chat context block), to avoid an
  // extra LLM round-trip per message.
  let aiInsight = '';
  if (includeInsight) {
    const { systemInstruction, prompt } = buildForecastPrompt({
      historicalMonths,
      currentMonthSpend,
      forecastAmount,
      averageMonthlySpend,
      trend,
      daysElapsed,
      totalDays,
      daysRemaining,
    }, language);
    aiInsight = await generateUserInsight({
      user_id,
      context: 'forecast',
      prompt,
      systemInstruction,
      maxOutputTokens: 200,
    });
  }

  const response: ForecastResponse = {
    historicalMonths,
    currentMonthSpend: round2(currentMonthSpend),
    forecastAmount,
    averageMonthlySpend: round2(averageMonthlySpend),
    daysRemaining,
    aiInsight,
    trend,
    dataQuality: {
      ...dataQuality,
      lowConfidenceSettlementSpend: round2(dataQuality.lowConfidenceSettlementSpend),
    },
  };

  await cacheService.set(cacheKey, response, 300);
  return response;
};
