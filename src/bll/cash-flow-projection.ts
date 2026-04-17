import { TransactionStatuses } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { Transactions, CardTransactions, Accounts } from '../collections';
import { detectRecurringTransactions } from './transactions';
import {
  CashFlowProjectionResponse,
  ProjectedEvent,
  SettlementSummary,
} from '../utils/types';
import cacheService from '../utils/cache-service';
import { toDateStr, addDays, diffDays } from '../utils/date-helpers';
import { normalize } from './recurring/normalization';
import { isCardProviderCompany } from '../utils/helpers';

const getCurrentMonthActualFilter = (user_id: string, currentMonthStart: string, todayStr: string) => ({
  user_id,
  status: TransactionStatuses.Completed,
  $or: [
    { processedDate: { $gte: currentMonthStart, $lte: todayStr } },
    { processedDate: { $exists: false }, date: { $gte: currentMonthStart, $lte: todayStr } },
    { processedDate: null, date: { $gte: currentMonthStart, $lte: todayStr } },
    { processedDate: '', date: { $gte: currentMonthStart, $lte: todayStr } },
  ],
});

type CurrentTransactionEvent = {
  amount: number;
  absAmount: number;
  kind: 'income' | 'expense';
  normalizedDescription: string;
  effectiveDate: string;
  companyId: string;
};

type GeneratedProjectedEvent = ProjectedEvent & {
  normalizedDescription: string;
  frequency: 'monthly' | 'weekly';
  tolerance: number;          // max days the event is allowed to slip before we call it 'missed'
  companyId?: string;
};

// Amount tolerance: within 15% of projected amount counts as "the same event".
// Wider than frequency-based matching but tight enough that a gift-card purchase
// at Netflix (say 50 ILS) does NOT cancel the real 54.90 subscription.
const AMOUNT_TOLERANCE_RATIO = 0.15;

const getMatchingActualIndex = (
  actuals: CurrentTransactionEvent[],
  event: GeneratedProjectedEvent
): number => {
  const toleranceDays = event.frequency === 'weekly' ? 2 : 5;
  const expectedAbs = Math.abs(event.amount);
  let bestIndex = -1;
  let bestDiff = Number.POSITIVE_INFINITY;

  actuals.forEach((actual, index) => {
    if (actual.kind !== event.type) return;
    if (actual.normalizedDescription !== event.normalizedDescription) return;

    const dateDiff = Math.abs(diffDays(actual.effectiveDate, event.expectedDate));
    if (dateDiff > toleranceDays) return;

    // Amount sanity: reject matches that differ > AMOUNT_TOLERANCE_RATIO.
    // This is the core fix for the "gift-card Netflix cancels real subscription" bug.
    if (expectedAbs > 0) {
      const amountDiffRatio = Math.abs(actual.absAmount - expectedAbs) / expectedAbs;
      if (amountDiffRatio > AMOUNT_TOLERANCE_RATIO) return;
    }

    if (dateDiff < bestDiff) {
      bestIndex = index;
      bestDiff = dateDiff;
    }
  });

  return bestIndex;
};

export const calculateCashFlowProjection = async (
  user_id: string
): Promise<CashFlowProjectionResponse> => {
  const cacheKey = `cashFlow:${user_id}`;
  const cached = await cacheService.get<CashFlowProjectionResponse>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const currentMonthStr = now.toISOString().slice(0, 7); // "YYYY-MM"
  const currentMonthStart = `${currentMonthStr}-01`;
  const todayStr = toDateStr(now);
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = totalDays - now.getDate();
  const monthEnd = `${currentMonthStr}-${String(totalDays).padStart(2, '0')}`;

  // --- Current month actuals ---
  const [regularTxns, cardTxns] = await Promise.all([
    Transactions.find(getCurrentMonthActualFilter(user_id, currentMonthStart, todayStr)).lean().exec(),
    CardTransactions.find(getCurrentMonthActualFilter(user_id, currentMonthStart, todayStr)).lean().exec(),
  ]);

  const allCurrent: CurrentTransactionEvent[] = [...regularTxns, ...cardTxns].map((t: any) => {
    const amount = t.amount ?? t.chargedAmount ?? 0;
    // IMPORTANT: mirror the fallback chain used by detection so memo-keyed
    // patterns can actually cancel here too.
    const descSource = t.description || t.memo || t.categoryDescription || t.channelName || '';
    return {
      amount,
      absAmount: Math.abs(amount),
      kind: amount >= 0 ? 'income' : 'expense',
      normalizedDescription: normalize(descSource),
      effectiveDate: toDateStr(t.processedDate ?? t.date),
      companyId: t.companyId ?? '',
    };
  });

  const incomeToDate = allCurrent
    .filter(t => t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);
  const expensesToDate = Math.abs(
    allCurrent.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0)
  );
  const netToDate = incomeToDate - expensesToDate;

  // --- Bank balance (main account) ---
  const accountDoc = await Accounts.findOne({ user_id }).lean().exec();
  const banks: any[] = (accountDoc as any)?.banks ?? [];
  const mainBank = banks.find((b: any) =>
    b.isMainAccount &&
    !b.isCardProvider &&
    typeof b?.details?.balance === 'number'
  ) ?? banks.find((b: any) =>
    !b.isCardProvider &&
    typeof b?.details?.balance === 'number'
  ) ?? null;
  const currentBalance: number | null = mainBank?.details?.balance ?? null;

  // --- Expected events from recurring transactions ---
  const recurring = await detectRecurringTransactions(user_id);

  const generatedEvents: GeneratedProjectedEvent[] = [];
  for (const group of recurring) {
    if (!group.nextExpected) continue;
    if (group.frequency === 'irregular' || group.frequency === 'unknown') continue;

    const expectedDates: string[] = [];
    const freq = group.frequency;
    if (freq === 'monthly') {
      if (group.nextExpected >= currentMonthStart && group.nextExpected <= monthEnd) {
        expectedDates.push(group.nextExpected);
      }
    } else if (freq === 'weekly' || freq === 'biweekly') {
      const stride = freq === 'biweekly' ? 14 : 7;
      let nextDate = group.nextExpected;
      while (nextDate <= monthEnd) {
        if (nextDate >= currentMonthStart) {
          expectedDates.push(nextDate);
        }
        nextDate = addDays(nextDate, stride);
      }
    } else {
      // biweekly/quarterly/etc falling inside this month — only emit if nextExpected is in-window.
      if (group.nextExpected >= currentMonthStart && group.nextExpected <= monthEnd) {
        expectedDates.push(group.nextExpected);
      }
    }

    // Stddev-aware tolerance — wider for weekly/biweekly so 1-2 day drifts stay matched.
    const baseTol = group.anchor?.stddevDays ?? (freq === 'weekly' ? 2 : 5);
    const tolerance = Math.max(2, Math.round(baseTol * 2));

    expectedDates.forEach((expectedDate) => {
      generatedEvents.push({
        description: group.description,
        amount: group.amount,
        expectedDate,
        type: group.kind,
        alreadyReceived: false,
        status: 'pending',
        confidence: group.confidence,
        merchantKey: group.merchantKey,
        classification: group.classification,
        patternId: group.patternId,
        source: group.source,
        normalizedDescription: group.normalizedDescription,
        frequency: freq === 'weekly' || freq === 'biweekly' ? 'weekly' : 'monthly',
        tolerance,
        companyId: group.transactions?.[0]?.companyId,
      });
    });
  }

  // Sort by date
  generatedEvents.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  // --- Bipartite match: greedy by date but amount-gated ---
  const unmatchedActuals = [...allCurrent];
  generatedEvents.forEach((event) => {
    const matchIndex = getMatchingActualIndex(unmatchedActuals, event);
    if (matchIndex === -1) return;

    event.alreadyReceived = true;
    event.status = 'realized';
    unmatchedActuals.splice(matchIndex, 1);
  });

  // --- Late-unmatched → missed, not pending ---
  // If an event is past its tolerance window with no matching actual, we treat
  // it as "likely skipped this cycle" and exclude it from pending totals.
  // Missed events are surfaced separately for visibility.
  generatedEvents.forEach((event) => {
    if (event.alreadyReceived) return;
    const lateBy = diffDays(event.expectedDate, todayStr);
    if (lateBy > event.tolerance) {
      event.status = 'missed';
    }
  });

  const missedEvents: ProjectedEvent[] = generatedEvents
    .filter((e) => e.status === 'missed')
    .map(({ normalizedDescription: _n, frequency: _f, tolerance: _t, companyId: _c, ...rest }) => rest);

  const expectedEvents: ProjectedEvent[] = generatedEvents.map(({
    normalizedDescription: _normalizedDescription,
    frequency: _frequency,
    tolerance: _tolerance,
    companyId: _companyId,
    ...event
  }) => event);

  // --- Projection ---
  // Pending = events still expected this month AND not already late-missed.
  const pendingList = generatedEvents.filter((e) => e.status === 'pending');
  const pendingExpenses = pendingList
    .filter((e) => e.type === 'expense')
    .reduce((s, e) => s + e.amount, 0);
  const pendingIncome = pendingList
    .filter((e) => e.type === 'income')
    .reduce((s, e) => s + e.amount, 0);

  // --- Settlement split (bank ledger vs card ledger) ---
  const bankPendingAgg = { income: 0, expense: 0 };
  const cardPendingAgg: { expense: number; byDate: Record<string, number> } = { expense: 0, byDate: {} };

  pendingList.forEach((e) => {
    const isCard = e.source === 'card' || isCardProviderCompany(e.companyId);
    if (isCard) {
      if (e.type === 'expense') {
        cardPendingAgg.expense += e.amount;
        // Settlement modeled simply as month-end. Future cycles (next month) are
        // excluded here — they carry into the next projection window.
        const settleDate = monthEnd;
        cardPendingAgg.byDate[settleDate] = (cardPendingAgg.byDate[settleDate] ?? 0) + e.amount;
      }
      // Card income is rare; leave on card ledger.
    } else {
      if (e.type === 'expense') bankPendingAgg.expense += e.amount;
      else bankPendingAgg.income += e.amount;
    }
  });

  const settlement: SettlementSummary = {
    bankPending: Math.round(bankPendingAgg.expense * 100) / 100,
    cardPending: Math.round(cardPendingAgg.expense * 100) / 100,
    cardSettlementByDate: Object.fromEntries(
      Object.entries(cardPendingAgg.byDate).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
  };

  const projectedMonthNet = netToDate + pendingIncome - pendingExpenses;
  const projectedEndBalance =
    currentBalance !== null
      ? Math.round((currentBalance + (projectedMonthNet - netToDate)) * 100) / 100
      : null;

  // --- Risk level ---
  // referenceAmount now prefers a stable denominator: max(income, expense) at start-of-month
  // may be tiny so we floor at 1 to avoid division nonsense.
  const referenceAmount = Math.max(incomeToDate, expensesToDate);
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (projectedMonthNet < 0) {
    riskLevel =
      referenceAmount > 0 && Math.abs(projectedMonthNet) / referenceAmount > 0.1
        ? 'high'
        : 'medium';
  } else if (referenceAmount > 0 && projectedMonthNet / referenceAmount < 0.05) {
    riskLevel = 'medium';
  }

  const response: CashFlowProjectionResponse = {
    incomeToDate: Math.round(incomeToDate * 100) / 100,
    expensesToDate: Math.round(expensesToDate * 100) / 100,
    netToDate: Math.round(netToDate * 100) / 100,
    expectedEvents,
    projectedMonthNet: Math.round(projectedMonthNet * 100) / 100,
    projectedEndBalance,
    currentBalance,
    riskLevel,
    daysRemaining,
    settlement,
    missedEvents,
  };

  await cacheService.set(cacheKey, response, 300);
  return response;
};
