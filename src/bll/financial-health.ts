import { GoogleGenerativeAI } from '@google/generative-ai';
import { TransactionStatuses } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { Transactions, CardTransactions, Categories, Accounts } from '../collections';
import { FinancialHealthResponse, ComponentResult } from '../utils/types';
import cacheService from '../utils/cache-service';

const toStatus = (score: number): 'good' | 'warning' | 'bad' =>
  score >= 70 ? 'good' : score >= 40 ? 'warning' : 'bad';

export const calculateFinancialHealth = async (
  user_id: string,
  language: string = 'en'
): Promise<FinancialHealthResponse> => {
  const cacheKey = `financialHealth:${user_id}:${language}`;
  const cached = await cacheService.get<FinancialHealthResponse>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const currentMonthStr = now.toISOString().slice(0, 7); // "YYYY-MM"
  const currentMonthStart = `${currentMonthStr}-01`;

  // --- Fetch current-month transactions (both collections) ---
  const [regularTxns, cardTxns] = await Promise.all([
    Transactions.find({
      user_id,
      status: TransactionStatuses.Completed,
      date: { $gte: currentMonthStart },
    }).lean().exec(),
    CardTransactions.find({
      user_id,
      status: TransactionStatuses.Completed,
      date: { $gte: currentMonthStart },
    }).lean().exec(),
  ]);

  const allCurrent = [...regularTxns, ...cardTxns].map((t: any) => ({
    amount: t.amount ?? t.chargedAmount ?? 0,
    category_id: t.category_id?.toString() ?? '',
  }));

  const incomeToDate = allCurrent.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expensesToDate = Math.abs(allCurrent.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const net = incomeToDate - expensesToDate;

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
  const cashFlow: ComponentResult = {
    score: cashFlowScore,
    status: cashFlowScore === 50 ? 'neutral' : toStatus(cashFlowScore),
    detail: cashFlowDetail,
  };

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
  const categoryBudgets: ComponentResult = {
    score: budgetsScore,
    status: budgetsScore === 50 ? 'neutral' : toStatus(budgetsScore),
    detail: budgetsDetail,
  };

  // --- Component 3: Savings Trend (last 3 complete months net) ---
  const threeMonthsAgoStr = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    .toISOString().slice(0, 10);

  const [histRegular, histCard] = await Promise.all([
    Transactions.find({
      user_id,
      status: TransactionStatuses.Completed,
      date: { $gte: threeMonthsAgoStr, $lt: currentMonthStart },
    }).lean().exec(),
    CardTransactions.find({
      user_id,
      status: TransactionStatuses.Completed,
      date: { $gte: threeMonthsAgoStr, $lt: currentMonthStart },
    }).lean().exec(),
  ]);

  const netByMonth = new Map<string, number>();
  for (const t of [...histRegular, ...histCard]) {
    const month = ((t as any).date as string).slice(0, 7);
    const amount = (t as any).amount ?? (t as any).chargedAmount ?? 0;
    netByMonth.set(month, (netByMonth.get(month) ?? 0) + amount);
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
  const savingsTrend: ComponentResult = {
    score: savingsScore,
    status: savingsScore === 50 ? 'neutral' : toStatus(savingsScore),
    detail: savingsDetail,
  };

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
  const debtPressure: ComponentResult = {
    score: debtScore,
    status: debtScore === 50 ? 'neutral' : toStatus(debtScore),
    detail: debtDetail,
  };

  // --- Overall score ---
  const score = Math.round(
    cashFlow.score * 0.30 +
    categoryBudgets.score * 0.25 +
    savingsTrend.score * 0.25 +
    debtPressure.score * 0.20
  );
  const status: 'good' | 'warning' | 'bad' = score >= 70 ? 'good' : score >= 40 ? 'warning' : 'bad';

  // --- Gemini insight ---
  let aiInsight = '';
  try {
    if (process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 200 },
        systemInstruction: `You are a personal finance assistant. Respond in ${language === 'he' ? 'Hebrew' : 'English'}. Be concise and helpful.`,
      });

      const prompt = `Financial health score: ${score}/100 (${status})
- Cash flow: ${cashFlow.detail} (score: ${cashFlow.score}/100)
- Category budgets: ${categoryBudgets.detail} (score: ${categoryBudgets.score}/100)
- Savings trend: ${savingsTrend.detail} (score: ${savingsTrend.score}/100)
- Debt pressure: ${debtPressure.detail} (score: ${debtPressure.score}/100)

Write 2-3 sentences: identify the main driver of this score and give one specific actionable improvement.`;

      const result = await model.generateContent(prompt);
      aiInsight = result.response.text();
    }
  } catch (err: any) {
    console.error('Gemini API error (financial-health):', err?.message ?? err);
  }

  const response: FinancialHealthResponse = {
    score,
    status,
    components: { cashFlow, categoryBudgets, savingsTrend, debtPressure },
    aiInsight,
  };

  await cacheService.set(cacheKey, response, 300);
  return response;
};
