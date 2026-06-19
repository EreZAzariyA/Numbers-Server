import { calculateForecast } from '../forecast';
import { calculateFinancialHealth } from '../financial-health';
import { calculateCashFlowProjection } from '../cash-flow-projection';
import savingsGoalsLogic from '../savings-goals';
import { detectRecurringTransactions } from '../transactions';
import { getUpcomingRenewals, DEFAULT_RENEWAL_WINDOW_DAYS } from '../recurring/renewals';
import { Categories } from '../../collections';
import { ClientError } from '../../models';
import type { ICategoryModel } from '../../models';
import { getEventDate } from '../../utils/transaction-semantics';
import {
  AgentToolDefinition,
  AgentTransactionRecord,
  BudgetStatusItem,
  ToolHost,
  TransactionCollectionType,
  UnifiedExpenseEntry,
} from './tool-types';
import {
  roundAmount,
  formatDateWindow,
  addMonths,
  startOfMonth,
  endOfMonth,
  TRANSACTION_FILTER_ENUM,
} from './tool-helpers';

export const createReadOnlyTools = (host: ToolHost): AgentToolDefinition[] => {
    return [
      {
        name: 'get_spending_by_merchant',
        description: 'Get total amount spent at a specific merchant or business.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            merchant_name: { type: 'string', description: 'Merchant name to search for.' },
            month: { type: 'number', description: '1-12. Defaults to the current month.' },
            year: { type: 'number', description: 'Full year. Defaults to the current year.' },
          },
          required: ['merchant_name'],
        },
        summarize: (args) => `Review spending for merchant ${args.merchant_name}.`,
        execute: async (args, context) => {
          const { merchant_name, month, year } = args;
          const { start, end } = host.getDateRange(month, year);
          const entries = await host.getUnifiedExpenseEntries(context.user_id, start, end);
          const normalizedMerchant = String(merchant_name ?? '').trim().toLowerCase();
          const matched = entries.filter((entry) =>
            [entry.description, entry.normalizedDescription].join(' ').toLowerCase().includes(normalizedMerchant),
          );
          const total = matched.reduce((sum, entry) => sum + entry.amount, 0);

          return {
            merchant: merchant_name,
            total: roundAmount(total),
            count: matched.length,
            period: formatDateWindow(start, end),
          };
        },
      },
      {
        name: 'get_category_totals',
        description: 'Get spending totals for all categories for a given month.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            month: { type: 'number', description: '1-12. Defaults to the current month.' },
            year: { type: 'number', description: 'Full year. Defaults to the current year.' },
          },
        },
        summarize: () => 'Review category totals.',
        execute: async (args, context) => {
          const { start, end } = host.getDateRange(args.month, args.year);
          const entries = await host.getUnifiedExpenseEntries(context.user_id, start, end);
          const totalsByCategory: Record<string, { name: string; total: number; count: number }> = {};

          for (const entry of entries) {
            const key = String(entry.category_id || entry.categoryName || 'uncategorized');
            if (!totalsByCategory[key]) {
              totalsByCategory[key] = {
                name: entry.categoryName || 'Uncategorized',
                total: 0,
                count: 0,
              };
            }
            totalsByCategory[key].total += entry.amount;
            totalsByCategory[key].count += 1;
          }

          return Object.values(totalsByCategory)
            .sort((left, right) => right.total - left.total)
            .map((entry) => ({ ...entry, total: roundAmount(entry.total) }));
        },
      },
      {
        name: 'get_monthly_summary',
        description: 'Get total income, expenses, and net for a given month.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            month: { type: 'number', description: '1-12. Defaults to the current month.' },
            year: { type: 'number', description: 'Full year. Defaults to the current year.' },
          },
        },
        summarize: () => 'Review the monthly summary.',
        execute: async (args, context) => {
          const { start, end } = host.getDateRange(args.month, args.year);
          const [transactions, expenseEntries] = await Promise.all([
            host.getBankTransactionsInRange(context.user_id, start, end),
            host.getUnifiedExpenseEntries(context.user_id, start, end),
          ]);

          let income = 0;
          for (const transaction of transactions) {
            if (transaction.amount > 0) income += transaction.amount;
          }
          const expenses = expenseEntries.reduce((sum, entry) => sum + entry.amount, 0);

          return {
            period: formatDateWindow(start, end),
            income: roundAmount(income),
            expenses: roundAmount(expenses),
            net: roundAmount(income - expenses),
          };
        },
      },
      {
        name: 'get_top_merchants',
        description: 'Get the top merchants by spending amount for a given month.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of merchants to return. Defaults to 5.' },
            month: { type: 'number', description: '1-12. Defaults to the current month.' },
            year: { type: 'number', description: 'Full year. Defaults to the current year.' },
          },
        },
        summarize: () => 'Review the top merchants.',
        execute: async (args, context) => {
          const { month, year } = args;
          const safeLimit = Math.min(Math.max(Number(args.limit || 5), 1), 50);
          const { start, end } = host.getDateRange(month, year);
          const entries = await host.getUnifiedExpenseEntries(context.user_id, start, end);
          const byMerchant: Record<string, number> = {};

          for (const entry of entries) {
            const key = entry.description || 'Unknown';
            byMerchant[key] = (byMerchant[key] || 0) + entry.amount;
          }

          return Object.entries(byMerchant)
            .sort(([, left], [, right]) => right - left)
            .slice(0, safeLimit)
            .map(([name, total]) => ({ name, total: roundAmount(total) }));
        },
      },
      {
        name: 'get_recent_transactions',
        description: 'Get recent transactions, optionally filtered by source, merchant, or date range.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            merchant_name: { type: 'string', description: 'Optional merchant name filter.' },
            transaction_type: {
              type: 'string',
              enum: TRANSACTION_FILTER_ENUM,
              description: 'Optional source filter. Use account-transactions for bank/account entries or card-transactions for credit-card entries.',
            },
            limit: { type: 'number', description: 'Number of transactions to return. Defaults to 10.' },
            start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format.' },
            end_date: { type: 'string', description: 'End date in YYYY-MM-DD format.' },
          },
        },
        summarize: () => 'Review recent transactions.',
        execute: async (args, context) => {
          const { merchant_name, start_date, end_date } = args;
          const safeLimit = Math.min(Math.max(Number(args.limit || 10), 1), 100);
          const transactionType = host.normalizeTransactionType(args.transaction_type);
          const now = new Date();
          const start = start_date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
          const end = end_date || now.toISOString().slice(0, 10);
          const [bankTransactions, cardTransactions] = await Promise.all([
            transactionType === 'creditCards'
              ? Promise.resolve([])
              : host.getBankTransactionsInRange(context.user_id, start, end),
            transactionType === 'transactions'
              ? Promise.resolve([])
              : host.getCardTransactionsInRange(context.user_id, start, end),
          ]);
          const taggedTransactions: Array<{ source: TransactionCollectionType; transaction: AgentTransactionRecord }> = [
            ...bankTransactions.map((transaction) => ({ source: 'transactions' as TransactionCollectionType, transaction })),
            ...cardTransactions.map((transaction) => ({ source: 'creditCards' as TransactionCollectionType, transaction })),
          ];
          const normalizedMerchant = String(merchant_name ?? '').trim().toLowerCase();
          const filtered = normalizedMerchant
            ? taggedTransactions.filter(({ transaction }) =>
              (transaction.description || '').toLowerCase().includes(normalizedMerchant),
            )
            : taggedTransactions;

          return filtered
            .sort((left, right) => right.transaction.eventDate.localeCompare(left.transaction.eventDate))
            .slice(0, safeLimit)
            .map(({ source, transaction }) => ({
              id: transaction._id.toString(),
              type: source,
              transaction_type: host.getTransactionLabel(source),
              date: getEventDate(transaction),
              description: transaction.description,
              amount: transaction.amount,
            }));
        },
      },
      {
        name: 'search_transactions',
        description: 'Search transactions across bank and credit-card collections using text, category, status, direction, amount, and date filters.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            query_text: { type: 'string', description: 'Optional free-text search across description, memo, category, and counterparty.' },
            merchant_name: { type: 'string', description: 'Optional merchant name filter, matched against the transaction description.' },
            category_id: { type: 'string', description: 'Optional category id filter.' },
            category_name: { type: 'string', description: 'Optional category name filter.' },
            transaction_type: {
              type: 'string',
              enum: TRANSACTION_FILTER_ENUM,
              description: 'Which transaction source to search. Use account-transactions for bank/account entries or card-transactions for credit-card entries.',
            },
            direction: { type: 'string', enum: ['all', 'income', 'expense'], description: 'Filter to income, expense, or both.' },
            status: { type: 'string', enum: ['all', 'completed', 'pending'], description: 'Filter by transaction status.' },
            start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format.' },
            end_date: { type: 'string', description: 'End date in YYYY-MM-DD format.' },
            min_amount: { type: 'number', description: 'Minimum absolute amount in shekels.' },
            max_amount: { type: 'number', description: 'Maximum absolute amount in shekels.' },
            card_last4: { type: 'string', description: 'Optional card last four digits filter.' },
            limit: { type: 'number', description: 'Maximum number of results to return. Defaults to 20.' },
            sort_by: { type: 'string', enum: ['date', 'amount'], description: 'Sort results by date or amount.' },
            sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort ascending or descending.' },
          },
        },
        summarize: () => 'Search transactions.',
        execute: async (args, context) => host.searchTransactionsForAgent(context.user_id, args),
      },
      {
        name: 'get_account_overview',
        description: 'Get a summary of connected bank accounts, balances, main account, credentials, savings, and loan totals.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the account overview.',
        execute: async (_, context) => host.getAccountOverviewForAgent(context.user_id),
      },
      {
        name: 'get_credit_card_snapshot',
        description: 'Get a snapshot of connected credit cards, upcoming debits, and framework usage.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the credit card snapshot.',
        execute: async (_, context) => host.getCreditCardSnapshotForAgent(context.user_id),
      },
      {
        name: 'detect_subscription_price_changes',
        description: 'Detect recurring expense patterns whose most recent amount looks like a subscription price change.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            min_change_amount: { type: 'number', description: 'Minimum absolute amount change in shekels. Defaults to 5.' },
            min_change_ratio: { type: 'number', description: 'Minimum relative change ratio. Defaults to 0.08 for 8%.' },
            include_decreases: { type: 'boolean', description: 'Whether to include price decreases as well as increases. Defaults to true.' },
            limit: { type: 'number', description: 'Maximum number of price changes to return. Defaults to 10.' },
          },
        },
        summarize: () => 'Detect subscription price changes.',
        execute: async (args, context) => host.detectSubscriptionPriceChangesForAgent(context.user_id, args),
      },
      {
        name: 'get_financial_health_overview',
        description: 'Get the full financial health assessment for the user.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the financial health overview.',
        execute: async (_, context) => calculateFinancialHealth(context.user_id, context.language, false),
      },
      {
        name: 'get_cash_flow_projection',
        description: 'Get the current month cash flow projection and risk outlook.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the cash flow projection.',
        execute: async (_, context) => calculateCashFlowProjection(context.user_id),
      },
      {
        name: 'get_forecast_details',
        description: 'Get the current spending forecast and historical comparison.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the spending forecast.',
        execute: async (_, context) => calculateForecast(context.user_id, context.language, false),
      },
      {
        name: 'get_financial_overview',
        description: "Get a one-call snapshot of the user's overall finances: financial-health score and components, current-month spending forecast, and savings-goals progress. Call this for big-picture questions (\"how am I doing\", budgeting, overall situation) or when you need background context before answering.",
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the financial overview.',
        execute: async (_, context) => {
          const [healthResult, forecastResult, goalsResult] = await Promise.allSettled([
            calculateFinancialHealth(context.user_id, context.language, false),
            calculateForecast(context.user_id, context.language, false),
            savingsGoalsLogic.fetchGoals(context.user_id, context.language),
          ]);

          return {
            financialHealth: healthResult.status === 'fulfilled'
              ? {
                  score: healthResult.value.score,
                  status: healthResult.value.status,
                  components: healthResult.value.components,
                }
              : null,
            monthForecast: forecastResult.status === 'fulfilled'
              ? {
                  currentMonthSpend: forecastResult.value.currentMonthSpend,
                  forecastAmount: forecastResult.value.forecastAmount,
                  averageMonthlySpend: forecastResult.value.averageMonthlySpend,
                  trend: forecastResult.value.trend,
                  daysRemaining: forecastResult.value.daysRemaining,
                }
              : null,
            savingsGoals: goalsResult.status === 'fulfilled' ? goalsResult.value : [],
          };
        },
      },
      {
        name: 'get_savings_goals_status',
        description: 'Get the list of savings goals and their progress.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the savings goals.',
        execute: async (_, context) => {
          const goals = await savingsGoalsLogic.fetchGoals(context.user_id, context.language);
          const totalTarget = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
          const totalSaved = goals.reduce((sum, goal) => sum + goal.currentAmount, 0);
          return {
            totalGoals: goals.length,
            totalTarget: roundAmount(totalTarget),
            totalSaved: roundAmount(totalSaved),
            remaining: roundAmount(totalTarget - totalSaved),
            goals,
          };
        },
      },
      {
        name: 'get_recurring_commitments',
        description: 'Get recurring income and expense commitments detected in the user account.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['income', 'expense'], description: 'Optional flow filter.' },
            source: { type: 'string', enum: ['bank', 'card'], description: 'Optional source filter.' },
            frequency: { type: 'string', description: 'Optional frequency filter.' },
            limit: { type: 'number', description: 'Maximum number of groups to return. Defaults to 10.' },
          },
        },
        summarize: () => 'Review recurring commitments.',
        execute: async (args, context) => {
          const groups = await detectRecurringTransactions(context.user_id, { dateBasis: 'event' });
          const filtered = groups
            .filter((group) => !args.kind || group.kind === args.kind)
            .filter((group) => !args.source || group.source === args.source)
            .filter((group) => !args.frequency || group.frequency === args.frequency);
          const limit = args.limit ?? 10;
          const expenses = filtered.filter((group) => group.kind === 'expense');
          const income = filtered.filter((group) => group.kind === 'income');

          return {
            totalGroups: filtered.length,
            monthlyExpenseRunRate: roundAmount(expenses
              .filter((group) => group.frequency === 'monthly')
              .reduce((sum, group) => sum + group.amount, 0)),
            monthlyIncomeRunRate: roundAmount(income
              .filter((group) => group.frequency === 'monthly')
              .reduce((sum, group) => sum + group.amount, 0)),
            groups: filtered.slice(0, limit),
          };
        },
      },
      {
        name: 'get_upcoming_renewals',
        description: 'Get subscriptions and fixed bills that are due to renew soon, with how many days until each charge.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            within_days: { type: 'number', description: 'Look-ahead window in days. Defaults to 7.' },
          },
        },
        summarize: () => 'Review upcoming renewals.',
        execute: async (args, context) => {
          const withinDays = args.within_days ?? DEFAULT_RENEWAL_WINDOW_DAYS;
          const renewals = await getUpcomingRenewals(context.user_id, withinDays);
          return {
            withinDays,
            totalRenewals: renewals.length,
            totalAmount: roundAmount(renewals.reduce((sum, renewal) => sum + renewal.amount, 0)),
            renewals,
          };
        },
      },
      {
        name: 'get_budget_status',
        description: 'Get active budget limits and how close the user is to each limit for a given month.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            month: { type: 'number', description: '1-12. Defaults to the current month.' },
            year: { type: 'number', description: 'Full year. Defaults to the current year.' },
          },
        },
        summarize: () => 'Review budget status.',
        execute: async (args, context) => {
          const { start, end } = host.getDateRange(args.month, args.year);
          const categoriesDoc = await Categories.findOne({ user_id: context.user_id }).exec();
          const categories: ICategoryModel[] = categoriesDoc?.categories ?? [];
          const activeBudgets = categories.filter((category) =>
            category.maximumSpentAllowed?.active && (category.maximumSpentAllowed?.maximumAmount ?? 0) > 0,
          );

          if (activeBudgets.length === 0) {
            return {
              period: formatDateWindow(start, end),
              summary: { activeBudgets: 0, overBudget: 0, warningBudgetCount: 0 },
              budgets: [],
            };
          }

          const expenses = await host.getUnifiedExpenseEntries(context.user_id, start, end);
          const spendByCategory = new Map<string, number>();
          for (const entry of expenses) {
            const key = entry.category_id || 'uncategorized';
            spendByCategory.set(key, (spendByCategory.get(key) ?? 0) + entry.amount);
          }

          const budgets: BudgetStatusItem[] = activeBudgets.map((category) => {
            const maximumSpentAllowed = category.maximumSpentAllowed;
            if (!maximumSpentAllowed) {
              throw new ClientError(500, 'Active budget is missing maximum spend settings.');
            }
            const spent = roundAmount(spendByCategory.get(category._id?.toString?.() ?? '') ?? 0);
            const limit = roundAmount(maximumSpentAllowed.maximumAmount);
            const usageRatio = limit > 0 ? spent / limit : 0;
            const remaining = roundAmount(limit - spent);
            const status: BudgetStatusItem['status'] = spent > limit ? 'over' : usageRatio >= 0.8 ? 'warning' : 'ok';

            return {
              category_id: category._id.toString(),
              name: category.name,
              spent,
              limit,
              remaining,
              usageRatio: roundAmount(usageRatio * 100),
              status,
            };
          }).sort((left, right) => right.spent - left.spent);

          return {
            period: formatDateWindow(start, end),
            summary: {
              activeBudgets: budgets.length,
              overBudget: budgets.filter((budget) => budget.status === 'over').length,
              warningBudgetCount: budgets.filter((budget) => budget.status === 'warning').length,
            },
            budgets,
          };
        },
      },
      {
        name: 'compare_spending_periods',
        description: 'Compare spending between two explicit date ranges.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            start_date_a: { type: 'string', description: 'Start date for period A in YYYY-MM-DD format.' },
            end_date_a: { type: 'string', description: 'End date for period A in YYYY-MM-DD format.' },
            start_date_b: { type: 'string', description: 'Start date for period B in YYYY-MM-DD format.' },
            end_date_b: { type: 'string', description: 'End date for period B in YYYY-MM-DD format.' },
            top_n: { type: 'number', description: 'Number of category deltas to return. Defaults to 5.' },
          },
          required: ['start_date_a', 'end_date_a', 'start_date_b', 'end_date_b'],
        },
        summarize: () => 'Compare spending periods.',
        execute: async (args, context) => {
          const periodAEntries = await host.getUnifiedExpenseEntries(context.user_id, args.start_date_a, args.end_date_a);
          const periodBEntries = await host.getUnifiedExpenseEntries(context.user_id, args.start_date_b, args.end_date_b);

          const summarizePeriod = (entries: UnifiedExpenseEntry[]) => ({
            total: roundAmount(entries.reduce((sum, entry) => sum + entry.amount, 0)),
            count: entries.length,
          });

          const categoryTotals = (entries: UnifiedExpenseEntry[]) => {
            const result = new Map<string, { name: string; total: number }>();
            for (const entry of entries) {
              const key = entry.category_id || entry.categoryName || 'uncategorized';
              const current = result.get(key) ?? { name: entry.categoryName || 'Uncategorized', total: 0 };
              current.total += entry.amount;
              result.set(key, current);
            }
            return result;
          };

          const periodA = summarizePeriod(periodAEntries);
          const periodB = summarizePeriod(periodBEntries);
          const periodACategories = categoryTotals(periodAEntries);
          const periodBCategories = categoryTotals(periodBEntries);
          const keys = new Set([...Array.from(periodACategories.keys()), ...Array.from(periodBCategories.keys())]);
          const topChanges = Array.from(keys).map((key) => {
            const left = periodACategories.get(key) ?? { name: 'Uncategorized', total: 0 };
            const right = periodBCategories.get(key) ?? { name: left.name, total: 0 };
            const delta = left.total - right.total;
            return {
              category: left.name || right.name,
              period_a: roundAmount(left.total),
              period_b: roundAmount(right.total),
              delta: roundAmount(delta),
              deltaPct: right.total > 0 ? roundAmount((delta / right.total) * 100) : null,
            };
          }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
            .slice(0, args.top_n ?? 5);

          const totalDelta = periodA.total - periodB.total;
          return {
            period_a: { start: args.start_date_a, end: args.end_date_a, ...periodA },
            period_b: { start: args.start_date_b, end: args.end_date_b, ...periodB },
            delta: roundAmount(totalDelta),
            deltaPct: periodB.total > 0 ? roundAmount((totalDelta / periodB.total) * 100) : null,
            top_category_changes: topChanges,
          };
        },
      },
      {
        name: 'find_spending_anomalies',
        description: 'Find merchants with unusual spend in a target month compared with recent history.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            month: { type: 'number', description: '1-12. Defaults to the current month.' },
            year: { type: 'number', description: 'Full year. Defaults to the current year.' },
            lookback_months: { type: 'number', description: 'Historical months to compare against. Defaults to 6.' },
            limit: { type: 'number', description: 'Maximum anomalies to return. Defaults to 5.' },
          },
        },
        summarize: () => 'Find spending anomalies.',
        execute: async (args, context) => {
          const now = new Date();
          const targetMonth = args.month ?? now.getMonth() + 1;
          const targetYear = args.year ?? now.getFullYear();
          const lookbackMonths = args.lookback_months ?? 6;
          const targetRange = host.getDateRange(targetMonth, targetYear);
          const historicalStartCursor = addMonths(targetYear, targetMonth, -lookbackMonths);
          const historicalStart = startOfMonth(historicalStartCursor.year, historicalStartCursor.month);
          const historicalEndCursor = addMonths(targetYear, targetMonth, -1);
          const historicalEnd = endOfMonth(historicalEndCursor.year, historicalEndCursor.month);

          const [targetEntries, historicalEntries] = await Promise.all([
            host.getUnifiedExpenseEntries(context.user_id, targetRange.start, targetRange.end),
            lookbackMonths > 0
              ? host.getUnifiedExpenseEntries(context.user_id, historicalStart, historicalEnd)
              : Promise.resolve([]),
          ]);

          const targetByMerchant = new Map<string, { name: string; total: number; count: number }>();
          for (const entry of targetEntries) {
            const key = entry.normalizedDescription || entry.description || 'unknown';
            const current = targetByMerchant.get(key) ?? { name: entry.description || 'Unknown', total: 0, count: 0 };
            current.total += entry.amount;
            current.count += 1;
            targetByMerchant.set(key, current);
          }

          const historicalByMerchantMonth = new Map<string, Map<string, number>>();
          for (const entry of historicalEntries) {
            const merchantKey = entry.normalizedDescription || entry.description || 'unknown';
            const monthKey = entry.date.slice(0, 7);
            const current = historicalByMerchantMonth.get(merchantKey) ?? new Map<string, number>();
            current.set(monthKey, (current.get(monthKey) ?? 0) + entry.amount);
            historicalByMerchantMonth.set(merchantKey, current);
          }

          const anomalies = Array.from(targetByMerchant.entries()).map(([merchantKey, current]) => {
            const merchantHistory = historicalByMerchantMonth.get(merchantKey);
            const historyTotal = merchantHistory
              ? Array.from(merchantHistory.values()).reduce((sum, value) => sum + value, 0)
              : 0;
            const historicalAverage = lookbackMonths > 0 ? historyTotal / lookbackMonths : 0;
            const increaseAmount = current.total - historicalAverage;
            const increaseRatio = historicalAverage > 0
              ? current.total / historicalAverage
              : current.total > 0
                ? null
                : 0;

            return {
              merchant: current.name,
              currentTotal: roundAmount(current.total),
              historicalAverage: roundAmount(historicalAverage),
              increaseAmount: roundAmount(increaseAmount),
              increaseRatio: increaseRatio === null ? null : roundAmount(increaseRatio),
              transactionCount: current.count,
              isNewMerchant: !merchantHistory || merchantHistory.size === 0,
            };
          }).filter((item) =>
            item.currentTotal >= 100 &&
            (item.isNewMerchant || (item.historicalAverage > 0 && item.currentTotal >= item.historicalAverage * 1.5)),
          ).sort((left, right) => right.increaseAmount - left.increaseAmount)
            .slice(0, args.limit ?? 5);

          return {
            targetPeriod: formatDateWindow(targetRange.start, targetRange.end),
            lookbackMonths,
            anomalies,
          };
        },
      },
      {
        name: 'simulate_month_end_scenario',
        description: 'Simulate how extra income or expenses would change the current month-end projection.',
        mode: 'read',
        schema: {
          type: 'object',
          properties: {
            adjustments: {
              type: 'array',
              description: 'Scenario adjustments to apply.',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string', description: 'Short description for the adjustment.' },
                  amount: { type: 'number', description: 'Positive amount in shekels.' },
                  type: { type: 'string', enum: ['income', 'expense'], description: 'Whether this is extra income or extra expense.' },
                },
                required: ['description', 'amount', 'type'],
              },
            },
          },
          required: ['adjustments'],
        },
        summarize: () => 'Simulate a month-end scenario.',
        execute: async (args, context) => {
          const baseline = await calculateCashFlowProjection(context.user_id);
          const adjustments = Array.isArray(args.adjustments) ? args.adjustments : [];
          const normalizedAdjustments = adjustments.map((item) => ({
            description: String(item.description || 'Scenario item'),
            amount: roundAmount(Math.abs(Number(item.amount) || 0)),
            type: item.type === 'income' ? 'income' : 'expense',
          })).filter((item) => item.amount > 0);

          const totalIncome = normalizedAdjustments
            .filter((item) => item.type === 'income')
            .reduce((sum, item) => sum + item.amount, 0);
          const totalExpense = normalizedAdjustments
            .filter((item) => item.type === 'expense')
            .reduce((sum, item) => sum + item.amount, 0);
          const delta = totalIncome - totalExpense;
          const projectedMonthNet = roundAmount(baseline.projectedMonthNet + delta);
          const projectedEndBalance = baseline.projectedEndBalance === null
            ? null
            : roundAmount(baseline.projectedEndBalance + delta);
          const riskLevel = host.buildMonthlyRiskLevel(
            projectedMonthNet,
            Math.max(baseline.incomeToDate, baseline.expensesToDate, 1),
          );

          return {
            baseline: {
              projectedMonthNet: baseline.projectedMonthNet,
              projectedEndBalance: baseline.projectedEndBalance,
              riskLevel: baseline.riskLevel,
            },
            adjustments: normalizedAdjustments,
            delta: roundAmount(delta),
            simulated: { projectedMonthNet, projectedEndBalance, riskLevel },
          };
        },
      },
    ];
};
