import { TransactionStatuses } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { Transactions, CardTransactions } from '../collections';
import { ForecastResponse, MonthlySpend } from '../utils/types';
import cacheService from '../utils/cache-service';
import { buildForecastPrompt } from '../utils/ai-prompts';
import { generateUserInsight } from '../utils/ai-provider';
import { buildSettlementTreatmentMap, classifySettlement } from '../utils/settlement-detection';
import { getEventDate, getTransactionAmount, getTransactionTextSource } from '../utils/transaction-semantics';

const getDaysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

export const calculateForecast = async (
  user_id: string,
  language: string = 'en'
): Promise<ForecastResponse> => {
  const cacheKey = `forecast:${user_id}:${language}`;
  const cached = await cacheService.get<ForecastResponse>(cacheKey);
  if (cached) return cached;

  const now = new Date();

  // Build since string — 7 months back (6 historical + current in-progress)
  // Critical: date field is stored as string "YYYY-MM-DD", use string comparison
  const since = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const sinceStr = since.toISOString().slice(0, 10);

  // Fetch from both collections (same pattern as detectRecurringTransactions)
  const [regularTxns, cardTxns] = await Promise.all([
    Transactions.find({
      user_id,
      status: TransactionStatuses.Completed,
      eventDate: { $gte: sinceStr },
    }).lean().exec(),
    CardTransactions.find({
      user_id,
      status: TransactionStatuses.Completed,
      eventDate: { $gte: sinceStr },
    }).lean().exec(),
  ]);

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
  const all = [...regularTxns, ...cardTxns]
    .map((t: any) => ({
      id: t._id?.toString?.() ?? '',
      month: getEventDate(t).slice(0, 7),
      rawAmount: getTransactionAmount(t),
      description: getTransactionTextSource(t),
    }))
    .filter((t) => {
      if (t.rawAmount >= 0) return false; // keep only expenses
      const settlementTreatment = settlementTreatments.get(t.id) ?? classifySettlement(t.description, hasCardData);
      if (settlementTreatment === 'exclude') return false;
      if (settlementTreatment === 'low-confidence') {
        dataQuality.lowConfidenceSettlementCount += 1;
        dataQuality.lowConfidenceSettlementSpend += Math.abs(t.rawAmount);
      }
      return true;
    })
    .map((t) => ({ month: t.month, amount: Math.abs(t.rawAmount) }));

  // Group by month
  const byMonth = new Map<string, number>();
  for (const t of all) {
    byMonth.set(t.month, (byMonth.get(t.month) ?? 0) + t.amount);
  }

  // Separate current month from historical
  const currentMonthStr = now.toISOString().slice(0, 7); // "YYYY-MM"
  const currentMonthSpend = byMonth.get(currentMonthStr) ?? 0;
  byMonth.delete(currentMonthStr);

  // Build sorted historical array (up to 6 most recent complete months)
  const historicalMonths: MonthlySpend[] = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([month, amount]) => ({ month, amount: Math.round(amount * 100) / 100 }));

  // Average from historical
  const averageMonthlySpend = historicalMonths.length > 0
    ? historicalMonths.reduce((s, m) => s + m.amount, 0) / historicalMonths.length
    : 0;

  // Pro-rate forecast
  const year = now.getFullYear();
  const month = now.getMonth();
  const totalDays = getDaysInMonth(year, month);
  const daysElapsed = now.getDate();
  const daysRemaining = totalDays - daysElapsed;

  const forecastAmount = daysElapsed > 0
    ? Math.round((currentMonthSpend / daysElapsed) * totalDays * 100) / 100
    : 0;

  // Trend
  let trend: 'up' | 'down' | 'flat' = 'flat';
  if (averageMonthlySpend > 0) {
    if (forecastAmount > averageMonthlySpend * 1.05) trend = 'up';
    else if (forecastAmount < averageMonthlySpend * 0.95) trend = 'down';
  }

  // Gemini AI insight — graceful degradation if key missing or call fails
  let aiInsight = '';
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

  const response: ForecastResponse = {
    historicalMonths,
    currentMonthSpend: Math.round(currentMonthSpend * 100) / 100,
    forecastAmount,
    averageMonthlySpend: Math.round(averageMonthlySpend * 100) / 100,
    daysRemaining,
    aiInsight,
    trend,
    dataQuality: {
      ...dataQuality,
      lowConfidenceSettlementSpend: Math.round(dataQuality.lowConfidenceSettlementSpend * 100) / 100,
    },
  };

  await cacheService.set(cacheKey, response, 300);
  return response;
};
