import { GoogleGenerativeAI } from '@google/generative-ai';
import { TransactionStatuses } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { Transactions, CardTransactions } from '../collections';
import { ForecastResponse, MonthlySpend } from '../utils/types';

const getDaysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

export const calculateForecast = async (
  user_id: string,
  language: string = 'en'
): Promise<ForecastResponse> => {
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
      date: { $gte: sinceStr },
    }).lean().exec(),
    CardTransactions.find({
      user_id,
      status: TransactionStatuses.Completed,
      date: { $gte: sinceStr },
    }).lean().exec(),
  ]);

  // Normalize — keep only expenses (amount < 0), take absolute value
  // Card transactions use chargedAmount as fallback (per recurring pattern)
  const all = [...regularTxns, ...cardTxns]
    .map((t: any) => ({
      month: (t.date as string).slice(0, 7),
      rawAmount: t.amount ?? t.chargedAmount ?? 0,
    }))
    .filter((t) => t.rawAmount < 0)
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
  try {
    if (process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 200 },
        systemInstruction: `You are a personal finance assistant. Respond in ${language === 'he' ? 'Hebrew' : 'English'}. Be concise and helpful.`,
      });

      const historicalSummary = historicalMonths
        .map((m) => `${m.month}: ${m.amount.toFixed(2)}`)
        .join(', ');

      const prompt = `Monthly spending data:
- Last ${historicalMonths.length} months: ${historicalSummary || 'No data'}
- 6-month average: ${averageMonthlySpend.toFixed(2)}
- Current month spend so far: ${currentMonthSpend.toFixed(2)} (${daysElapsed} of ${totalDays} days elapsed)
- Projected end-of-month: ${forecastAmount.toFixed(2)}
- Trend vs average: ${trend}

Write 2-3 sentences of insight. Include: whether spending is above or below average, what that means for the budget, and one brief actionable tip.`;

      const result = await model.generateContent(prompt);
      aiInsight = result.response.text();
    }
  } catch (err: any) {
    console.error('Gemini API error:', err?.message ?? err);
  }

  return {
    historicalMonths,
    currentMonthSpend: Math.round(currentMonthSpend * 100) / 100,
    forecastAmount,
    averageMonthlySpend: Math.round(averageMonthlySpend * 100) / 100,
    daysRemaining,
    aiInsight,
    trend,
  };
};
