import { Categories, Accounts } from '../collections';
import { FinancialHealthResponse, ComponentResult } from '../utils/types';
import cacheService from '../utils/cache-service';
import { buildFinancialHealthPrompt } from '../utils/ai-prompts';
import { generateUserInsight } from '../utils/ai-provider';
import { buildSettlementTreatmentMap } from '../utils/settlement-detection';
import { getEventDate, getTransactionAmount, getTransactionTextSource } from '../utils/transaction-semantics';
import { monthBounds } from '../utils/date-helpers';
import { round2, sumIncomeExpense } from '../utils/money';
import { fetchCompletedTransactions } from './shared/transaction-queries';
import { filterAndTallySettlements } from './shared/settlement-filter';

const toStatus = (score: number): 'good' | 'warning' | 'bad' =>
  score >= 70 ? 'good' : score >= 40 ? 'warning' : 'bad';

// A score of exactly 50 is the "no data" sentinel → neutral; otherwise grade it.
const makeComponent = (score: number, detail: string): ComponentResult => ({
  score,
  status: score === 50 ? 'neutral' : toStatus(score),
  detail,
});

export const calculateFinancialHealth = async (
  user_id: string,
  language: string = 'en',
  includeInsight: boolean = true,
): Promise<FinancialHealthResponse> => {
  const baseKey = `financialHealth:${user_id}:${language}`;
  const cacheKey = includeInsight ? baseKey : `${baseKey}:lite`;
  let cached = await cacheService.get<FinancialHealthResponse>(cacheKey);
  if (!cached && !includeInsight) {
    // Reuse the dashboard's full (insight-bearing) cache when it is already warm.
    cached = await cacheService.get<FinancialHealthResponse>(baseKey);
  }
  if (cached) return cached;

  const now = new Date();
  const { start: currentMonthStart } = monthBounds(now);

  // --- Fetch current-month transactions (both collections) ---
  const { regularTxns, cardTxns } = await fetchCompletedTransactions(user_id, {
    eventDate: { $gte: currentMonthStart },
  });

  const hasCardData = cardTxns.length > 0;
  const settlementTreatments = buildSettlementTreatmentMap(regularTxns, cardTxns);
  const dataQuality = {
    lowConfidenceSettlementCount: 0,
    lowConfidenceSettlementSpend: 0,
    hasGranularCardData: hasCardData,
  };

  const allCurrent = filterAndTallySettlements(
    [...regularTxns, ...cardTxns],
    settlementTreatments,
    hasCardData,
    {
      id: (t: any) => t._id?.toString?.() ?? '',
      text: (t: any) => getTransactionTextSource(t),
      amount: (t: any) => getTransactionAmount(t),
    },
    dataQuality,
  ).map((t: any) => ({
    amount: getTransactionAmount(t),
    category_id: t.category_id?.toString() ?? '',
  }));

  const { income: incomeToDate, net } =
    sumIncomeExpense(allCurrent.map((t) => t.amount));

  // --- Component 1: Cash Flow ---
  let cashFlowScore = 50;
  let cashFlowDetail = 'No income detected this month';
  if (incomeToDate > 0) {
    const ratio = net / incomeToDate;
    if (ratio > 0.1) {
      cashFlowScore = 100;
      cashFlowDetail = `Net +${Math.round(net).toLocaleString()} this month`;
    } else if (ratio >= -0.1) {
      cashFlowScore = 60;
      cashFlowDetail = `Near break-even (${Math.round(net).toLocaleString()})`;
    } else {
      cashFlowScore = 20;
      cashFlowDetail = `Deficit of ${Math.round(Math.abs(net)).toLocaleString()} this month`;
    }
  }
  const cashFlow = makeComponent(cashFlowScore, cashFlowDetail);

  // --- Component 2: Category Budgets ---
  const categoriesDoc = await Categories.findOne({ user_id }).lean().exec();
  const cats: any[] = (categoriesDoc as any)?.categories ?? [];
  const activeLimits = cats.filter(
    (c: any) => c.maximumSpentAllowed?.active && (c.maximumSpentAllowed?.maximumAmount ?? 0) > 0
  );

  let budgetsScore = 50;
  let budgetsDetail = 'No budget limits set';
  if (activeLimits.length > 0) {
    const spendByCategory = new Map<string, number>();
    for (const t of allCurrent) {
      if (t.amount >= 0) continue; // skip income
      const spent = spendByCategory.get(t.category_id) ?? 0;
      spendByCategory.set(t.category_id, spent + Math.abs(t.amount));
    }
    const exceededCount = activeLimits.filter((c: any) => {
      const spent = spendByCategory.get(c._id?.toString()) ?? 0;
      return spent > c.maximumSpentAllowed.maximumAmount;
    }).length;

    if (exceededCount === 0) {
      budgetsScore = 100;
      budgetsDetail = `All ${activeLimits.length} budget limits within range`;
    } else if (exceededCount === 1) {
      budgetsScore = 65;
      budgetsDetail = `${exceededCount} budget limit exceeded this month`;
    } else if (exceededCount === 2) {
      budgetsScore = 35;
      budgetsDetail = `${exceededCount} budget limits exceeded this month`;
    } else {
      budgetsScore = 10;
      budgetsDetail = `${exceededCount} budget limits exceeded this month`;
    }
  }
  const categoryBudgets = makeComponent(budgetsScore, budgetsDetail);

  // --- Component 3: Savings Trend (last 3 complete months net) ---
  const threeMonthsAgoStr = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    .toISOString().slice(0, 10);

  const { regularTxns: histRegular, cardTxns: histCard } = await fetchCompletedTransactions(user_id, {
    eventDate: { $gte: threeMonthsAgoStr, $lt: currentMonthStart },
  });

  const hasHistCardData = histCard.length > 0;
  const historicalSettlementTreatments = buildSettlementTreatmentMap(histRegular, histCard);
  dataQuality.hasGranularCardData = hasCardData || hasHistCardData;

  const netByMonth = new Map<string, number>();
  const keptHist = filterAndTallySettlements(
    [...histRegular, ...histCard],
    historicalSettlementTreatments,
    hasHistCardData,
    {
      id: (t: any) => t._id?.toString?.() ?? '',
      text: (t: any) => getTransactionTextSource(t),
      amount: (t: any) => getTransactionAmount(t),
    },
    dataQuality,
  );
  for (const t of keptHist) {
    const month = getEventDate(t as any).slice(0, 7);
    netByMonth.set(month, (netByMonth.get(month) ?? 0) + getTransactionAmount(t as any));
  }
  const monthNets = Array.from(netByMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v);

  let savingsScore = 50;
  let savingsDetail = 'Not enough historical data';
  if (monthNets.length >= 2) {
    const allPositive = monthNets.every(n => n > 0);
    const improving = monthNets[monthNets.length - 1] > monthNets[monthNets.length - 2];
    if (allPositive && improving) {
      savingsScore = 100;
      savingsDetail = 'Savings growing month over month';
    } else if (allPositive) {
      savingsScore = 70;
      savingsDetail = 'Net positive savings (flat trend)';
    } else if (monthNets[monthNets.length - 1] > 0) {
      savingsScore = 55;
      savingsDetail = 'Mixed trend — last month was positive';
    } else {
      savingsScore = 15;
      savingsDetail = 'Spending exceeded income in recent months';
    }
  }
  const savingsTrend = makeComponent(savingsScore, savingsDetail);

  // --- Component 4: Debt Pressure ---
  const accountDoc = await Accounts.findOne({ user_id }).lean().exec();
  const banks: any[] = (accountDoc as any)?.banks ?? [];
  const totalMonthlyLoanPayment = banks.reduce((sum: number, bank: any) => {
    return sum + (bank.loans?.summary?.currentMonthTotalPayment ?? 0);
  }, 0);

  let debtScore = 100;
  let debtDetail = 'No loan payments detected';
  if (totalMonthlyLoanPayment > 0) {
    if (incomeToDate > 0) {
      const ratio = totalMonthlyLoanPayment / incomeToDate;
      if (ratio < 0.30) {
        debtScore = 100;
        debtDetail = `Loan payments are ${Math.round(ratio * 100)}% of income`;
      } else if (ratio < 0.50) {
        debtScore = 55;
        debtDetail = `Loan payments are ${Math.round(ratio * 100)}% of income`;
      } else {
        debtScore = 20;
        debtDetail = `High debt load: ${Math.round(ratio * 100)}% of income`;
      }
    } else {
      debtScore = 50;
      debtDetail = `Monthly loan payments: ${Math.round(totalMonthlyLoanPayment).toLocaleString()}`;
    }
  }
  const debtPressure = makeComponent(debtScore, debtDetail);

  // --- Overall score ---
  const score = Math.round(
    cashFlow.score * 0.30 +
    categoryBudgets.score * 0.25 +
    savingsTrend.score * 0.25 +
    debtPressure.score * 0.20
  );
  const status = toStatus(score);

  // --- AI insight (skipped when only the numbers are needed, e.g. chat context) ---
  let aiInsight = '';
  if (includeInsight) {
    const { systemInstruction, prompt } = buildFinancialHealthPrompt({
      score,
      status,
      components: { cashFlow, categoryBudgets, savingsTrend, debtPressure },
    }, language);
    aiInsight = await generateUserInsight({
      user_id,
      context: 'financial-health',
      prompt,
      systemInstruction,
      maxOutputTokens: 200,
    });
  }

  const response: FinancialHealthResponse = {
    score,
    status,
    components: { cashFlow, categoryBudgets, savingsTrend, debtPressure },
    aiInsight,
    dataQuality: {
      ...dataQuality,
      lowConfidenceSettlementSpend: round2(dataQuality.lowConfidenceSettlementSpend),
    },
  };

  await cacheService.set(cacheKey, response, 300);
  return response;
};
