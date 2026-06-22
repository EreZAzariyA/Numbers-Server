import { SavingsGoals, Transactions, CardTransactions, Categories } from '../../collections';
import { ClientError } from '../../models';
import type { ICategoryModel } from '../../models';
import type { ISavingsGoalModel } from '../../models/savings-goal-model';
import type { MainTransactionType } from '../../utils/types';
import { buildInclusiveDateRangeFilter, roundAmount, startOfMonth, endOfMonth } from './tool-helpers';
import { fetchCompletedTransactions } from '../shared/transaction-queries';
import { buildSettlementTreatmentMap } from '../../utils/settlement-detection';
import { filterAndTallySettlements } from '../shared/settlement-filter';
import { normalize } from '../recurring/normalization';
import { detectRecurringTransactions } from '../transactions';
import { getEventDate, getPostingDate, getTransactionAmount, getTransactionTextSource } from '../../utils/transaction-semantics';
import bankLogic from '../banks';
import type {
  AgentTransactionRecord,
  AgentTransactionFilterType,
  AgentTransactionLabel,
  UnifiedExpenseEntry,
  TransactionCollectionType,
} from './tool-types';

export type AgentSearchTransactionResult = {
  id: string;
  type: TransactionCollectionType;
  transaction_type: AgentTransactionLabel;
  date: string | null;
  postingDate: string | null;
  description: string;
  amount: number;
  status: string;
  companyId: string | null;
  category_id: string | null;
  category: string | null;
  cardLast4: string | number | null;
  counterparty: string | null;
};

type AgentCardSnapshotSource = {
  cardUniqueId?: string;
  cardName?: string;
  cardFamilyDescription?: string;
  cardTypeDescription?: string;
  last4Digits?: string | number;
  cardNumber?: string | number;
  firstName?: string;
  lastName?: string;
  cardFramework?: string | number;
  cardFrameworkUsed?: string | number;
  cardFrameworkNotUsed?: string | number;
  dateOfUpcomingDebit?: string;
  NISTotalDebit?: string | number;
  cardStatusCode?: string | number;
};

export const TRANSACTION_TYPE_ALIASES: Record<string, AgentTransactionFilterType> = {
  all: 'all',
  transactions: 'transactions',
  transaction: 'transactions',
  'account-transactions': 'transactions',
  'account-transaction': 'transactions',
  account: 'transactions',
  accounts: 'transactions',
  'bank-transactions': 'transactions',
  'bank-transaction': 'transactions',
  bank: 'transactions',
  banks: 'transactions',
  creditcards: 'creditCards',
  'credit-cards': 'creditCards',
  'credit-card': 'creditCards',
  'credit-card-transactions': 'creditCards',
  'credit-card-transaction': 'creditCards',
  'card-transactions': 'creditCards',
  'card-transaction': 'creditCards',
  card: 'creditCards',
  cards: 'creditCards',
};

export function normalizeTransactionType(type?: string | null): AgentTransactionFilterType {
  const normalizedType = String(type ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (!normalizedType) return 'all';
  return TRANSACTION_TYPE_ALIASES[normalizedType] ?? 'all';
}

export function getTransactionLabel(type: TransactionCollectionType): AgentTransactionLabel {
  return type === 'creditCards' ? 'card-transactions' : 'account-transactions';
}

export function getDateRange(month?: number, year?: number): { start: string; end: string } {
  const now = new Date();
  const normalizedMonth = month ?? now.getMonth() + 1;
  const normalizedYear = year ?? now.getFullYear();
  return {
    start: startOfMonth(normalizedYear, normalizedMonth),
    end: endOfMonth(normalizedYear, normalizedMonth),
  };
}

export async function getBankTransactionsInRange(user_id: string, start: string, end: string) {
  return Transactions.find({ user_id, eventDate: buildInclusiveDateRangeFilter(start, end) }).lean().exec();
}

export async function getCardTransactionsInRange(user_id: string, start: string, end: string) {
  return CardTransactions.find({ user_id, eventDate: buildInclusiveDateRangeFilter(start, end) }).lean().exec();
}

async function getCompletedTransactionsInRange(user_id: string, start: string, end: string) {
  const { regularTxns, cardTxns } = await fetchCompletedTransactions(user_id, {
    eventDate: buildInclusiveDateRangeFilter(start, end),
  });
  return {
    regularTxns: regularTxns as AgentTransactionRecord[],
    cardTxns: cardTxns as AgentTransactionRecord[],
  };
}

export async function getUnifiedExpenseEntries(user_id: string, start: string, end: string): Promise<UnifiedExpenseEntry[]> {
  const { regularTxns, cardTxns } = await getCompletedTransactionsInRange(user_id, start, end);
  const hasCardData = cardTxns.length > 0;
  const settlementTreatments = buildSettlementTreatmentMap(regularTxns, cardTxns);
  const dataQuality = {
    lowConfidenceSettlementCount: 0,
    lowConfidenceSettlementSpend: 0,
  };

  const expenses = [...regularTxns, ...cardTxns]
    .map((transaction) => ({ transaction, amount: getTransactionAmount(transaction) }))
    .filter(({ amount }) => amount < 0);

  return filterAndTallySettlements(
    expenses,
    settlementTreatments,
    hasCardData,
    {
      id: ({ transaction }) => transaction._id?.toString?.() ?? '',
      text: ({ transaction }) => getTransactionTextSource(transaction),
      amount: ({ amount }) => amount,
    },
    dataQuality,
  ).map(({ transaction, amount }) => ({
      amount: Math.abs(amount),
      category_id: transaction.category_id?.toString?.() ?? '',
      categoryName: transaction.category || transaction.providerCategoryName || 'Uncategorized',
      description: transaction.description ?? '',
      normalizedDescription: normalize(transaction.description ?? ''),
      date: getPostingDate(transaction) || getEventDate(transaction),
    }));
}

export async function resolveCategory(
  user_id: string,
  options: { category_id?: string; category_name?: string },
): Promise<ICategoryModel> {
  const categoriesDoc = await Categories.findOne({ user_id }).exec();
  const categories = categoriesDoc?.categories ?? [];

  if (options.category_id) {
    const found = categories.find((category) => category._id.toString() === options.category_id);
    if (found) return found;
  }

  if (options.category_name) {
    const normalizedName = options.category_name.trim().toLowerCase();
    const found = categories.find((category) => category.name?.trim().toLowerCase() === normalizedName);
    if (found) return found;
  }

  throw new ClientError(404, 'Category not found.');
}

export async function resolveTransaction(
  user_id: string,
  transactionId: string,
  type?: string,
): Promise<{ transaction: MainTransactionType; type: TransactionCollectionType }> {
  if (!transactionId) {
    throw new ClientError(400, 'Transaction id is required.');
  }

  const normalizedType = normalizeTransactionType(type);

  if (normalizedType === 'transactions') {
    const transaction = await Transactions.findOne({ _id: transactionId, user_id }).exec();
    if (!transaction) throw new ClientError(404, 'Transaction not found.');
    return { transaction: transaction as MainTransactionType, type: 'transactions' };
  }

  if (normalizedType === 'creditCards') {
    const transaction = await CardTransactions.findOne({ _id: transactionId, user_id }).exec();
    if (!transaction) throw new ClientError(404, 'Transaction not found.');
    return { transaction: transaction as MainTransactionType, type: 'creditCards' };
  }

  const [bankTransaction, cardTransaction] = await Promise.all([
    Transactions.findOne({ _id: transactionId, user_id }).exec(),
    CardTransactions.findOne({ _id: transactionId, user_id }).exec(),
  ]);

  if (bankTransaction) return { transaction: bankTransaction as MainTransactionType, type: 'transactions' };
  if (cardTransaction) return { transaction: cardTransaction as MainTransactionType, type: 'creditCards' };

  throw new ClientError(404, 'Transaction not found.');
}

export async function getSavingsGoalById(user_id: string, goalId: string): Promise<ISavingsGoalModel> {
  const doc = await SavingsGoals.findOne({ user_id, 'goals._id': goalId }).exec();
  const goal = doc?.goals?.find((item) => item._id.toString() === goalId);
  if (!goal) {
    throw new ClientError(404, 'Savings goal not found.');
  }
  return goal;
}

export async function getAccountOverviewForAgent(user_id: string): Promise<Record<string, unknown>> {
  const account = await bankLogic.fetchMainAccountResponse(user_id);
  const banks = account?.banks ?? [];
  const latestConnection = banks.reduce((latest, bank) => Math.max(latest, bank?.lastConnection || 0), 0);
  const mainAccount = banks.find((bank) => bank.isMainAccount) ?? null;
  const totalBalance = banks.reduce((sum, bank) => sum + (Number(bank?.details?.balance) || 0), 0);
  const totalSavings = banks.reduce((sum, bank) => sum + (Number(bank?.savings?.totalDepositsCurrentValue) || 0), 0);
  const totalLoanBalance = banks.reduce((sum, bank) => sum + (Number(bank?.loans?.summary?.totalBalance) || 0), 0);
  const currentMonthLoanPayments = banks.reduce((sum, bank) => sum + (Number(bank?.loans?.summary?.currentMonthTotalPayment) || 0), 0);

  return {
    connectedBanks: banks.length,
    cardProviders: banks.filter((bank) => bank.isCardProvider).length,
    savedCredentials: banks.filter((bank) => !!bank.credentials).length,
    totalBalance: roundAmount(totalBalance),
    totalSavings: roundAmount(totalSavings),
    totalLoanBalance: roundAmount(totalLoanBalance),
    currentMonthLoanPayments: roundAmount(currentMonthLoanPayments),
    latestConnection: latestConnection ? new Date(latestConnection).toISOString() : null,
    mainAccount: mainAccount ? {
      id: mainAccount._id?.toString?.() ?? null,
      bankName: mainAccount.bankName,
      balance: roundAmount(Number(mainAccount?.details?.balance) || 0),
      accountNumber: mainAccount?.details?.accountNumber ?? null,
      lastConnection: mainAccount.lastConnection ? new Date(mainAccount.lastConnection).toISOString() : null,
      isCardProvider: mainAccount.isCardProvider,
    } : null,
    accounts: banks.map((bank) => ({
      id: bank._id?.toString?.() ?? null,
      bankName: bank.bankName,
      isMainAccount: !!bank.isMainAccount,
      isCardProvider: !!bank.isCardProvider,
      balance: roundAmount(Number(bank?.details?.balance) || 0),
      accountNumber: bank?.details?.accountNumber ?? null,
      lastConnection: bank.lastConnection ? new Date(bank.lastConnection).toISOString() : null,
      hasCredentials: !!bank.credentials,
      cardsCount: bank.cardsPastOrFutureDebit?.cardsBlock?.length ?? 0,
    })),
  };
}

export async function getCreditCardSnapshotForAgent(user_id: string): Promise<Record<string, unknown>> {
  const account = await bankLogic.fetchMainAccountResponse(user_id);
  const banks = account?.banks ?? [];
  const cardProviders = banks.filter((bank) =>
    bank.isCardProvider || (bank.cardsPastOrFutureDebit?.cardsBlock?.length ?? 0) > 0,
  );

  const cards = cardProviders.flatMap((bank) =>
    (bank.cardsPastOrFutureDebit?.cardsBlock ?? []).map((card: AgentCardSnapshotSource) => ({
      providerId: bank._id?.toString?.() ?? null,
      providerName: bank.bankName,
      cardUniqueId: card.cardUniqueId ?? null,
      cardName: card.cardName ?? null,
      cardFamilyDescription: card.cardFamilyDescription ?? null,
      cardTypeDescription: card.cardTypeDescription ?? null,
      cardLast4: card.last4Digits || String(card.cardNumber ?? '').slice(-4) || null,
      holderName: [card.firstName, card.lastName].filter(Boolean).join(' ') || null,
      framework: roundAmount(Number(card.cardFramework) || 0),
      frameworkUsed: roundAmount(Number(card.cardFrameworkUsed) || 0),
      frameworkAvailable: roundAmount(
        Number(card.cardFrameworkNotUsed) || Math.max(0, (Number(card.cardFramework) || 0) - (Number(card.cardFrameworkUsed) || 0)),
      ),
      upcomingDebitDate: card.dateOfUpcomingDebit || null,
      upcomingDebitNIS: roundAmount(Number(card.NISTotalDebit) || 0),
      statusCode: card.cardStatusCode ?? null,
    })),
  );

  const upcomingDebitByDate = cards.reduce<Record<string, number>>((acc, card) => {
    if (!card.upcomingDebitDate) return acc;
    acc[card.upcomingDebitDate] = roundAmount((acc[card.upcomingDebitDate] || 0) + Number(card.upcomingDebitNIS || 0));
    return acc;
  }, {});

  const totalFramework = cards.reduce((sum, card) => sum + Number(card.framework || 0), 0);
  const totalUsed = cards.reduce((sum, card) => sum + Number(card.frameworkUsed || 0), 0);
  const totalUpcomingDebit = cards.reduce((sum, card) => sum + Number(card.upcomingDebitNIS || 0), 0);

  return {
    totalCards: cards.length,
    providerCount: cardProviders.length,
    totalFramework: roundAmount(totalFramework),
    totalFrameworkUsed: roundAmount(totalUsed),
    totalFrameworkAvailable: roundAmount(Math.max(0, totalFramework - totalUsed)),
    totalUpcomingDebitNIS: roundAmount(totalUpcomingDebit),
    upcomingDebitByDate,
    cards: cards.sort((left, right) => String(left.upcomingDebitDate || '').localeCompare(String(right.upcomingDebitDate || ''))),
  };
}

export async function detectSubscriptionPriceChangesForAgent(
  user_id: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const groups = await detectRecurringTransactions(user_id, { dateBasis: 'event' });
  const minChangeAmount = Math.abs(Number(args.min_change_amount) || 5);
  const minChangeRatio = Math.abs(Number(args.min_change_ratio) || 0.08);
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
  const includeDecreases = args.include_decreases !== false;

  const median = (values: number[]): number => {
    const sorted = [...values].sort((left, right) => left - right);
    if (sorted.length === 0) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  };

  const changes = groups
    .filter((group) => group.kind === 'expense')
    .filter((group) => ['monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual'].includes(String(group.frequency)))
    .filter((group) => (group.transactions?.length ?? 0) >= 3)
    .map((group) => {
      const orderedTransactions = [...(group.transactions ?? [])]
        .sort((left, right) => String(left.eventDate || left.postingDate || '').localeCompare(String(right.eventDate || right.postingDate || '')));
      const amounts = orderedTransactions.map((transaction) => Math.abs(Number(transaction.amount) || 0));
      const latestAmount = amounts[amounts.length - 1] ?? 0;
      const previousAmounts = amounts.slice(0, -1);
      const previousMedian = median(previousAmounts);
      const previousAverage = previousAmounts.length
        ? previousAmounts.reduce((sum, value) => sum + value, 0) / previousAmounts.length
        : 0;
      const previousMax = previousAmounts.length ? Math.max(...previousAmounts) : 0;
      const previousMin = previousAmounts.length ? Math.min(...previousAmounts) : 0;
      const stabilityRatio = previousMedian > 0 ? (previousMax - previousMin) / previousMedian : 1;
      const changeAmount = latestAmount - previousMedian;
      const changeRatio = previousMedian > 0 ? changeAmount / previousMedian : 0;
      const direction = changeAmount >= 0 ? 'increase' : 'decrease';

      return {
        merchant: group.description,
        source: group.source ?? null,
        frequency: group.frequency,
        classification: group.classification ?? null,
        latestAmount: roundAmount(latestAmount),
        previousMedian: roundAmount(previousMedian),
        previousAverage: roundAmount(previousAverage),
        changeAmount: roundAmount(changeAmount),
        changeRatio: roundAmount(changeRatio * 100),
        direction,
        lastSeen: orderedTransactions[orderedTransactions.length - 1]?.eventDate
          || orderedTransactions[orderedTransactions.length - 1]?.postingDate
          || null,
        previousSeen: orderedTransactions[orderedTransactions.length - 2]?.eventDate
          || orderedTransactions[orderedTransactions.length - 2]?.postingDate
          || null,
        occurrences: orderedTransactions.length,
        nextExpected: group.nextExpected,
        stabilityRatio: roundAmount(stabilityRatio * 100),
      };
    })
    .filter((change) => Math.abs(Number(change.changeAmount) || 0) >= minChangeAmount)
    .filter((change) => Math.abs((Number(change.changeRatio) || 0) / 100) >= minChangeRatio)
    .filter((change) => (includeDecreases ? true : change.direction === 'increase'))
    .filter((change) => Number(change.stabilityRatio) <= 12)
    .sort((left, right) => Math.abs(Number(right.changeAmount) || 0) - Math.abs(Number(left.changeAmount) || 0))
    .slice(0, limit);

  return {
    totalChanges: changes.length,
    minChangeAmount: roundAmount(minChangeAmount),
    minChangeRatioPct: roundAmount(minChangeRatio * 100),
    changes,
  };
}

export async function searchTransactionsForAgent(
  user_id: string,
  args: Record<string, unknown>,
): Promise<{
  totalMatches: number;
  transactions: Array<Record<string, unknown>>;
  appliedFilters: Record<string, unknown>;
}> {
  const transactionType = normalizeTransactionType(args.transaction_type as string | undefined);
  const direction = args.direction === 'income' || args.direction === 'expense'
    ? args.direction as string
    : 'all';
  const status = args.status === 'completed' || args.status === 'pending'
    ? args.status as string
    : 'all';
  const sortBy = args.sort_by === 'amount' ? 'amount' : 'date';
  const sortOrder = args.sort_order === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const startDate = (args.start_date as string) || '1900-01-01';
  const endDate = (args.end_date as string) || '2999-12-31';
  const minAmount = args.min_amount !== undefined ? Math.abs(Number(args.min_amount) || 0) : null;
  const maxAmount = args.max_amount !== undefined ? Math.abs(Number(args.max_amount) || 0) : null;

  const category = args.category_id || args.category_name
    ? await resolveCategory(user_id, {
      category_id: args.category_id as string | undefined,
      category_name: args.category_name as string | undefined,
    })
    : null;

  const query: Record<string, unknown> = {
    user_id,
    eventDate: buildInclusiveDateRangeFilter(startDate, endDate),
  };
  if (status !== 'all') {
    query.status = status;
  }
  if (category?._id) {
    query.category_id = category._id;
  }

  const [bankTransactions, cardTransactions] = await Promise.all([
    transactionType === 'creditCards' ? Promise.resolve([]) : Transactions.find(query).lean().exec(),
    transactionType === 'transactions' ? Promise.resolve([]) : CardTransactions.find(query).lean().exec(),
  ]);

  const normalizedQuery = String(args.query_text || '').trim().toLowerCase();
  const normalizedMerchant = String(args.merchant_name || '').trim().toLowerCase();
  const normalizedCardLast4 = String(args.card_last4 || '').trim();

  const matchesText = (transaction: AgentTransactionRecord): boolean => {
    const haystack = [
      transaction.description,
      transaction.memo,
      transaction.providerCategoryName,
      transaction.counterparty,
      transaction.category,
      transaction.cardLast4,
    ].filter(Boolean).join(' ').toLowerCase();

    if (normalizedQuery && !haystack.includes(normalizedQuery)) return false;
    if (normalizedMerchant && !(transaction.description || '').toLowerCase().includes(normalizedMerchant)) return false;
    if (normalizedCardLast4 && String(transaction.cardLast4 || transaction.cardNumber || '').slice(-4) !== normalizedCardLast4) return false;
    return true;
  };

  const matchesAmount = (transaction: AgentTransactionRecord): boolean => {
    const absoluteAmount = Math.abs(Number(transaction.amount) || 0);
    if (minAmount !== null && absoluteAmount < minAmount) return false;
    if (maxAmount !== null && absoluteAmount > maxAmount) return false;
    return true;
  };

  const matchesDirection = (transaction: AgentTransactionRecord): boolean => {
    if (direction === 'all') return true;
    if (direction === 'income') return Number(transaction.amount) > 0;
    return Number(transaction.amount) < 0;
  };

  const taggedTransactions: Array<{ source: TransactionCollectionType; transaction: AgentTransactionRecord }> = [
    ...bankTransactions.map((transaction) => ({ source: 'transactions' as TransactionCollectionType, transaction })),
    ...cardTransactions.map((transaction) => ({ source: 'creditCards' as TransactionCollectionType, transaction })),
  ];

  const transactions: AgentSearchTransactionResult[] = taggedTransactions
    .filter(({ transaction }) => matchesDirection(transaction))
    .filter(({ transaction }) => matchesAmount(transaction))
    .filter(({ transaction }) => matchesText(transaction))
    .map(({ source, transaction }) => ({
      id: transaction._id.toString(),
      type: source,
      transaction_type: getTransactionLabel(source),
      date: getEventDate(transaction) || null,
      postingDate: getPostingDate(transaction) || null,
      description: transaction.description ?? '',
      amount: roundAmount(Number(transaction.amount) || 0),
      status: transaction.status ?? '',
      companyId: transaction.companyId ?? null,
      category_id: transaction.category_id?.toString?.() ?? null,
      category: transaction.category || transaction.providerCategoryName || null,
      cardLast4: transaction.cardLast4 ?? transaction.cardNumber ?? null,
      counterparty: transaction.counterparty || null,
    }));

  transactions.sort((left, right) => {
    if (sortBy === 'amount') {
      return sortOrder === 'asc'
        ? Number(left.amount) - Number(right.amount)
        : Number(right.amount) - Number(left.amount);
    }

    const leftDate = String(left.date || '');
    const rightDate = String(right.date || '');
    return sortOrder === 'asc'
      ? leftDate.localeCompare(rightDate)
      : rightDate.localeCompare(leftDate);
  });

  return {
    totalMatches: transactions.length,
    transactions: transactions.slice(0, limit),
    appliedFilters: {
      transaction_type: transactionType === 'all' ? 'all' : getTransactionLabel(transactionType),
      collection_type: transactionType === 'all' ? 'all' : transactionType,
      direction,
      status,
      start_date: args.start_date ?? null,
      end_date: args.end_date ?? null,
      category_id: category?._id?.toString?.() ?? null,
      category_name: category?.name ?? args.category_name ?? null,
      min_amount: minAmount,
      max_amount: maxAmount,
      sort_by: sortBy,
      sort_order: sortOrder,
    },
  };
}

export function buildMonthlyRiskLevel(projectedMonthNet: number, referenceAmount: number): 'low' | 'medium' | 'high' {
  if (projectedMonthNet < 0) {
    return referenceAmount > 0 && Math.abs(projectedMonthNet) / referenceAmount > 0.1
      ? 'high'
      : 'medium';
  }

  return referenceAmount > 0 && projectedMonthNet / referenceAmount < 0.05 ? 'medium' : 'low';
}
