"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateCashFlowProjection = void 0;
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const collections_1 = require("../collections");
const transactions_2 = require("./transactions");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
const date_helpers_1 = require("../utils/date-helpers");
const normalization_1 = require("./recurring/normalization");
const helpers_1 = require("../utils/helpers");
const settlement_detection_1 = require("../utils/settlement-detection");
const transaction_semantics_1 = require("../utils/transaction-semantics");
const getCurrentMonthActualFilter = (user_id, currentMonthStart, todayStr) => ({
    user_id,
    status: transactions_1.TransactionStatuses.Completed,
    $or: [
        { postingDate: { $gte: currentMonthStart, $lte: todayStr } },
        { postingDate: { $exists: false }, eventDate: { $gte: currentMonthStart, $lte: todayStr } },
        { postingDate: null, eventDate: { $gte: currentMonthStart, $lte: todayStr } },
        { postingDate: '', eventDate: { $gte: currentMonthStart, $lte: todayStr } },
    ],
});
// Amount tolerance: within 15% of projected amount counts as "the same event".
// Wider than frequency-based matching but tight enough that a gift-card purchase
// at Netflix (say 50 ILS) does NOT cancel the real 54.90 subscription.
const AMOUNT_TOLERANCE_RATIO = 0.15;
const getMatchingActualIndex = (actuals, event) => {
    const toleranceDays = event.frequency === 'weekly' ? 2 : 5;
    const expectedAbs = Math.abs(event.amount);
    let bestIndex = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    actuals.forEach((actual, index) => {
        if (actual.kind !== event.type)
            return;
        if (actual.normalizedDescription !== event.normalizedDescription)
            return;
        const dateDiff = Math.abs((0, date_helpers_1.diffDays)(actual.effectiveDate, event.expectedDate));
        if (dateDiff > toleranceDays)
            return;
        // Amount sanity: reject matches that differ > AMOUNT_TOLERANCE_RATIO.
        // This is the core fix for the "gift-card Netflix cancels real subscription" bug.
        if (expectedAbs > 0) {
            const amountDiffRatio = Math.abs(actual.absAmount - expectedAbs) / expectedAbs;
            if (amountDiffRatio > AMOUNT_TOLERANCE_RATIO)
                return;
        }
        if (dateDiff < bestDiff) {
            bestIndex = index;
            bestDiff = dateDiff;
        }
    });
    return bestIndex;
};
const calculateCashFlowProjection = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _d, _e, _g, _h, _j;
    const cacheKey = `cashFlow:${user_id}`;
    const cached = yield cache_service_1.default.get(cacheKey);
    if (cached)
        return cached;
    const now = new Date();
    const currentMonthStr = now.toISOString().slice(0, 7); // "YYYY-MM"
    const currentMonthStart = `${currentMonthStr}-01`;
    const todayStr = (0, date_helpers_1.toDateStr)(now);
    const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = totalDays - now.getDate();
    const monthEnd = `${currentMonthStr}-${String(totalDays).padStart(2, '0')}`;
    // --- Current month actuals ---
    const [regularTxns, cardTxns] = yield Promise.all([
        collections_1.Transactions.find(getCurrentMonthActualFilter(user_id, currentMonthStart, todayStr)).lean().exec(),
        collections_1.CardTransactions.find(getCurrentMonthActualFilter(user_id, currentMonthStart, todayStr)).lean().exec(),
    ]);
    // Exclude credit-card settlement rows when granular card data exists.
    const hasCardData = cardTxns.length > 0;
    const allCurrent = [...regularTxns, ...cardTxns]
        .filter((t) => {
        const desc = (0, transaction_semantics_1.getTransactionTextSource)(t);
        return (0, settlement_detection_1.classifySettlement)(desc, hasCardData) !== 'exclude';
    })
        .map((t) => {
        var _a;
        const amount = (0, transaction_semantics_1.getTransactionAmount)(t);
        const descSource = (0, transaction_semantics_1.getTransactionTextSource)(t);
        return {
            amount,
            absAmount: Math.abs(amount),
            kind: amount >= 0 ? 'income' : 'expense',
            normalizedDescription: (0, normalization_1.normalize)(descSource),
            effectiveDate: (0, transaction_semantics_1.getPostingDate)(t) || (0, transaction_semantics_1.getEventDate)(t),
            companyId: (_a = t.companyId) !== null && _a !== void 0 ? _a : '',
        };
    });
    const incomeToDate = allCurrent
        .filter(t => t.amount > 0)
        .reduce((s, t) => s + t.amount, 0);
    const expensesToDate = Math.abs(allCurrent.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
    const netToDate = incomeToDate - expensesToDate;
    // --- Bank balance (main account) ---
    const accountDoc = yield collections_1.Accounts.findOne({ user_id }).lean().exec();
    const banks = (_a = accountDoc === null || accountDoc === void 0 ? void 0 : accountDoc.banks) !== null && _a !== void 0 ? _a : [];
    const mainBank = (_d = (_b = banks.find((b) => {
        var _a;
        return b.isMainAccount &&
            !b.isCardProvider &&
            typeof ((_a = b === null || b === void 0 ? void 0 : b.details) === null || _a === void 0 ? void 0 : _a.balance) === 'number';
    })) !== null && _b !== void 0 ? _b : banks.find((b) => {
        var _a;
        return !b.isCardProvider &&
            typeof ((_a = b === null || b === void 0 ? void 0 : b.details) === null || _a === void 0 ? void 0 : _a.balance) === 'number';
    })) !== null && _d !== void 0 ? _d : null;
    const currentBalance = (_g = (_e = mainBank === null || mainBank === void 0 ? void 0 : mainBank.details) === null || _e === void 0 ? void 0 : _e.balance) !== null && _g !== void 0 ? _g : null;
    // --- Expected events from recurring transactions ---
    const recurring = yield (0, transactions_2.detectRecurringTransactions)(user_id);
    const generatedEvents = [];
    for (const group of recurring) {
        if (!group.nextExpected)
            continue;
        if (group.frequency === 'irregular' || group.frequency === 'unknown')
            continue;
        const expectedDates = [];
        const freq = group.frequency;
        if (freq === 'monthly') {
            if (group.nextExpected >= currentMonthStart && group.nextExpected <= monthEnd) {
                expectedDates.push(group.nextExpected);
            }
        }
        else if (freq === 'weekly' || freq === 'biweekly') {
            const stride = freq === 'biweekly' ? 14 : 7;
            let nextDate = group.nextExpected;
            while (nextDate <= monthEnd) {
                if (nextDate >= currentMonthStart) {
                    expectedDates.push(nextDate);
                }
                nextDate = (0, date_helpers_1.addDays)(nextDate, stride);
            }
        }
        else {
            // biweekly/quarterly/etc falling inside this month — only emit if nextExpected is in-window.
            if (group.nextExpected >= currentMonthStart && group.nextExpected <= monthEnd) {
                expectedDates.push(group.nextExpected);
            }
        }
        // Stddev-aware tolerance — wider for weekly/biweekly so 1-2 day drifts stay matched.
        const baseTol = (_j = (_h = group.anchor) === null || _h === void 0 ? void 0 : _h.stddevDays) !== null && _j !== void 0 ? _j : (freq === 'weekly' ? 2 : 5);
        const tolerance = Math.max(2, Math.round(baseTol * 2));
        expectedDates.forEach((expectedDate) => {
            var _a, _b;
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
                companyId: (_b = (_a = group.transactions) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.companyId,
            });
        });
    }
    // Sort by date
    generatedEvents.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    // --- Bipartite match: greedy by date but amount-gated ---
    const unmatchedActuals = [...allCurrent];
    generatedEvents.forEach((event) => {
        const matchIndex = getMatchingActualIndex(unmatchedActuals, event);
        if (matchIndex === -1)
            return;
        event.alreadyReceived = true;
        event.status = 'realized';
        unmatchedActuals.splice(matchIndex, 1);
    });
    // --- Late-unmatched → missed, not pending ---
    // If an event is past its tolerance window with no matching actual, we treat
    // it as "likely skipped this cycle" and exclude it from pending totals.
    // Missed events are surfaced separately for visibility.
    generatedEvents.forEach((event) => {
        if (event.alreadyReceived)
            return;
        const lateBy = (0, date_helpers_1.diffDays)(event.expectedDate, todayStr);
        if (lateBy > event.tolerance) {
            event.status = 'missed';
        }
    });
    const missedEvents = generatedEvents
        .filter((e) => e.status === 'missed')
        .map((_a) => {
        var { normalizedDescription: _n, frequency: _f, tolerance: _t, companyId: _c } = _a, rest = __rest(_a, ["normalizedDescription", "frequency", "tolerance", "companyId"]);
        return rest;
    });
    const expectedEvents = generatedEvents.map((_a) => {
        var { normalizedDescription: _normalizedDescription, frequency: _frequency, tolerance: _tolerance, companyId: _companyId } = _a, event = __rest(_a, ["normalizedDescription", "frequency", "tolerance", "companyId"]);
        return event;
    });
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
    const cardPendingAgg = { expense: 0, byDate: {} };
    pendingList.forEach((e) => {
        var _a;
        const isCard = e.source === 'card' || (0, helpers_1.isCardProviderCompany)(e.companyId);
        if (isCard) {
            if (e.type === 'expense') {
                cardPendingAgg.expense += e.amount;
                // Settlement modeled simply as month-end. Future cycles (next month) are
                // excluded here — they carry into the next projection window.
                const settleDate = monthEnd;
                cardPendingAgg.byDate[settleDate] = ((_a = cardPendingAgg.byDate[settleDate]) !== null && _a !== void 0 ? _a : 0) + e.amount;
            }
            // Card income is rare; leave on card ledger.
        }
        else {
            if (e.type === 'expense')
                bankPendingAgg.expense += e.amount;
            else
                bankPendingAgg.income += e.amount;
        }
    });
    const settlement = {
        bankPending: Math.round(bankPendingAgg.expense * 100) / 100,
        cardPending: Math.round(cardPendingAgg.expense * 100) / 100,
        cardSettlementByDate: Object.fromEntries(Object.entries(cardPendingAgg.byDate).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    };
    const projectedMonthNet = netToDate + pendingIncome - pendingExpenses;
    const projectedEndBalance = currentBalance !== null
        ? Math.round((currentBalance + (projectedMonthNet - netToDate)) * 100) / 100
        : null;
    // --- Risk level ---
    // referenceAmount now prefers a stable denominator: max(income, expense) at start-of-month
    // may be tiny so we floor at 1 to avoid division nonsense.
    const referenceAmount = Math.max(incomeToDate, expensesToDate);
    let riskLevel = 'low';
    if (projectedMonthNet < 0) {
        riskLevel =
            referenceAmount > 0 && Math.abs(projectedMonthNet) / referenceAmount > 0.1
                ? 'high'
                : 'medium';
    }
    else if (referenceAmount > 0 && projectedMonthNet / referenceAmount < 0.05) {
        riskLevel = 'medium';
    }
    const response = {
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
    yield cache_service_1.default.set(cacheKey, response, 300);
    return response;
});
exports.calculateCashFlowProjection = calculateCashFlowProjection;
