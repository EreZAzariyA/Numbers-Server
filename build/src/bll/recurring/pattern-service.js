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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.overridePattern = exports.getRecurringGroups = exports.getPatterns = exports.recomputePatterns = void 0;
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const collections_1 = require("../../collections");
const date_helpers_1 = require("../../utils/date-helpers");
const helpers_1 = require("../../utils/helpers");
const normalization_1 = require("./normalization");
const merchant_key_1 = require("./merchant-key");
const amount_clustering_1 = require("./amount-clustering");
const frequency_detection_1 = require("./frequency-detection");
const classifier_1 = require("./classifier");
const confidence_1 = require("./confidence");
const settlement_detection_1 = require("../../utils/settlement-detection");
const config_1 = __importDefault(require("../../utils/config"));
const transaction_semantics_1 = require("../../utils/transaction-semantics");
// Maximum tx IDs stored per pattern for traceability.
const MAX_OCCURRENCE_TX_IDS = 24;
const PATTERN_KEY_PREFIX_RE = /^(bank|card):(income|expense):/;
/**
 * Full recompute of all recurring patterns for a user.
 * This is the worker's main entry-point; it reads raw transactions,
 * groups/clusters/classifies them, then upserts `RecurringPatterns`.
 */
const recomputePatterns = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const since = new Date();
    since.setMonth(since.getMonth() - 12);
    const sinceStr = since.toISOString().slice(0, 10);
    const [regularTxns, cardTxns] = yield Promise.all([
        collections_1.Transactions.find({ user_id, status: transactions_1.TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
        collections_1.CardTransactions.find({ user_id, status: transactions_1.TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
    ]);
    // Prepare flat list with merchantKey.
    // Settlement rows should never be promoted into recurring spend patterns.
    const hasCardData = cardTxns.length > 0;
    const settlementTreatments = (0, settlement_detection_1.buildSettlementTreatmentMap)(regularTxns, cardTxns);
    const allTxs = [...regularTxns, ...cardTxns].map((t) => {
        var _a, _b, _c, _d, _e;
        return ({
            _id: t._id.toString(),
            eventDate: (0, transaction_semantics_1.getEventDate)(t),
            postingDate: (0, transaction_semantics_1.getPostingDate)(t),
            amount: (0, transaction_semantics_1.getTransactionAmount)(t),
            originalAmount: t.originalAmount,
            originalCurrency: t.originalCurrency,
            chargedAmount: t.chargedAmount,
            description: (_a = t.description) !== null && _a !== void 0 ? _a : '',
            memo: (_b = t.memo) !== null && _b !== void 0 ? _b : '',
            providerCategoryName: (0, transaction_semantics_1.getProviderCategoryName)(t),
            counterparty: (0, transaction_semantics_1.getCounterparty)(t),
            companyId: (_c = t.companyId) !== null && _c !== void 0 ? _c : '',
            category_id: (_e = (_d = t.category_id) === null || _d === void 0 ? void 0 : _d.toString()) !== null && _e !== void 0 ? _e : '',
            rawTransaction: t.rawTransaction,
            type: t.type,
            installments: t.installments,
            kind: (0, transaction_semantics_1.getTransactionAmount)(t) >= 0 ? 'income' : 'expense',
            source: (0, helpers_1.isCardProviderCompany)(t.companyId) ? 'card' : 'bank',
            merchantId: (0, transaction_semantics_1.getMerchantId)(t),
            mcc: (0, transaction_semantics_1.getMcc)(t),
            cardLast4: (0, transaction_semantics_1.getCardLast4)(t),
            semanticType: (0, transaction_semantics_1.getSemanticType)(t),
            merchantKey: '',
        });
    }).filter((t) => {
        var _a;
        return Math.abs(t.amount) > 0 &&
            ((_a = settlementTreatments.get(t._id)) !== null && _a !== void 0 ? _a : (0, settlement_detection_1.classifySettlement)(t.description, hasCardData)) === 'normal';
    });
    // Compute merchant keys.
    for (const tx of allTxs) {
        tx.merchantKey = (0, merchant_key_1.buildMerchantKey)(tx);
    }
    // Group by (source, kind, merchantKey) with agreesOn corroboration.
    // Including source prevents the same charge from merging across bank and card collections.
    const groupMap = new Map();
    for (const tx of allTxs) {
        const groupKey = `${tx.source}:${tx.kind}:${tx.merchantKey}`;
        if (!groupMap.has(groupKey)) {
            groupMap.set(groupKey, [tx]);
            continue;
        }
        // Check signal agreement with any existing member.
        const existing = groupMap.get(groupKey);
        if ((0, merchant_key_1.agreesOn)(tx, existing[0], 1)) {
            existing.push(tx);
        }
        else {
            // Doesn't pass corroboration — start separate group under a disambiguated key.
            const altKey = `${groupKey}:${tx._id}`;
            if (!groupMap.has(altKey))
                groupMap.set(altKey, []);
            groupMap.get(altKey).push(tx);
        }
    }
    // Load existing user overrides to preserve them across recomputes.
    const existingPatterns = yield collections_1.RecurringPatterns.find({ user_id }).lean().exec();
    const overrideByKey = new Map();
    for (const p of existingPatterns) {
        if (p.userOverride)
            overrideByKey.set(p.merchantKey, p.userOverride);
    }
    const upsertOps = [];
    for (const [, txGroup] of groupMap) {
        if (txGroup.length < frequency_detection_1.MIN_RECURRING_OCCURRENCES)
            continue;
        // Amount clustering within the group.
        const clusters = (0, amount_clustering_1.clusterAmounts)(txGroup);
        for (const cluster of clusters) {
            const clusterTxs = cluster.txIndices.map((i) => txGroup[i]);
            if (clusterTxs.length < frequency_detection_1.MIN_RECURRING_OCCURRENCES)
                continue;
            const months = new Set(clusterTxs.map((t) => t.postingDate.slice(0, 7)));
            if (months.size < 2)
                continue;
            const dates = clusterTxs.map((t) => t.postingDate);
            const freqResult = (0, frequency_detection_1.detectFrequency)(dates);
            if (freqResult.freq === 'unknown' || freqResult.freq === 'irregular')
                continue;
            // Check for installment plan.
            const installmentTxs = clusterTxs.filter((t) => { var _a; return t.type === transactions_1.TransactionTypes.Installments || ((_a = t.installments) === null || _a === void 0 ? void 0 : _a.total); });
            let installmentPlan = null;
            if (installmentTxs.length > 0) {
                const latest = installmentTxs.sort((a, b) => b.postingDate.localeCompare(a.postingDate))[0];
                const total = (_b = (_a = latest.installments) === null || _a === void 0 ? void 0 : _a.total) !== null && _b !== void 0 ? _b : 0;
                const current = (_d = (_c = latest.installments) === null || _c === void 0 ? void 0 : _c.number) !== null && _d !== void 0 ? _d : 0;
                const remaining = Math.max(0, total - current);
                installmentPlan = {
                    paymentsRemaining: remaining,
                    totalPayments: total,
                    monthlyAmount: cluster.mean,
                    expectedLastPaymentDate: remaining > 0
                        ? (0, frequency_detection_1.nextOccurrence)(latest.postingDate, 'monthly', freqResult.anchor)
                        : latest.postingDate,
                };
                // Recalculate expected last for remaining months.
                if (remaining > 1) {
                    let d = latest.postingDate;
                    for (let i = 0; i < remaining; i++) {
                        d = (0, frequency_detection_1.nextOccurrence)(d, 'monthly', freqResult.anchor);
                    }
                    installmentPlan.expectedLastPaymentDate = d;
                }
            }
            const amountStability = cluster.mean > 0
                ? Math.min(1, Math.max(0, 1 - (cluster.stddev / cluster.mean)))
                : 0;
            // Collect signals.
            const signals = {
                companyIds: [...new Set(clusterTxs.map((t) => t.companyId).filter(Boolean))],
                categoryIds: [...new Set(clusterTxs.map((t) => t.category_id).filter(Boolean))],
                channels: [...new Set(clusterTxs.map((t) => t.counterparty).filter(Boolean))],
                descriptionVariants: [...new Set(clusterTxs.map((t) => t.description).filter(Boolean))].slice(0, 10),
                memoVariants: [...new Set(clusterTxs.map((t) => t.memo).filter(Boolean))].slice(0, 10),
            };
            const kind = clusterTxs[0].kind;
            const source = clusterTxs[0].source;
            const patternKey = `${source}:${kind}:${clusterTxs[0].merchantKey}`;
            const classification = (0, classifier_1.classify)({
                kind,
                frequency: freqResult.freq,
                stability: freqResult.stability,
                amountStability,
                installmentTotal: installmentPlan === null || installmentPlan === void 0 ? void 0 : installmentPlan.totalPayments,
                counterparty: signals.channels[0],
                occurrences: clusterTxs.length,
                providerCategoryName: clusterTxs[0].providerCategoryName,
            });
            // Count missed cycles in last 6 expected periods.
            const missedInLast6Cycles = computeMissedCycles(dates, freqResult, 6);
            const userOverride = (_e = overrideByKey.get(patternKey)) !== null && _e !== void 0 ? _e : null;
            const confidence = (0, confidence_1.computeConfidence)({
                occurrences: clusterTxs.length,
                stability: freqResult.stability,
                amountMean: cluster.mean,
                amountStddev: cluster.stddev,
                signals,
                missedInLast6Cycles,
                userConfirmed: (_f = userOverride === null || userOverride === void 0 ? void 0 : userOverride.confirmed) !== null && _f !== void 0 ? _f : false,
            });
            const sortedDates = [...dates].sort();
            const observed = {
                firstSeen: sortedDates[0],
                lastSeen: sortedDates[sortedDates.length - 1],
                occurrences: clusterTxs.length,
                missedInLast6Cycles,
                occurrenceTxIds: clusterTxs
                    .sort((a, b) => b.postingDate.localeCompare(a.postingDate))
                    .slice(0, MAX_OCCURRENCE_TX_IDS)
                    .map((t) => t._id),
            };
            upsertOps.push({
                updateOne: {
                    filter: { user_id, merchantKey: patternKey },
                    update: {
                        $set: Object.assign({ source,
                            classification,
                            kind, frequency: freqResult.freq, anchor: freqResult.anchor, amount: {
                                mean: Math.round(cluster.mean * 100) / 100,
                                median: Math.round(cluster.median * 100) / 100,
                                stddev: Math.round(cluster.stddev * 100) / 100,
                                min: Math.round(cluster.min * 100) / 100,
                                max: Math.round(cluster.max * 100) / 100,
                                currency: cluster.currency,
                                isFx: cluster.isFx,
                            }, installmentPlan,
                            observed, confidence: Math.round(confidence * 1000) / 1000, stability: Math.round(freqResult.stability * 1000) / 1000, signals }, (userOverride ? {} : { userOverride: null })),
                        $setOnInsert: Object.assign({ user_id, merchantKey: patternKey }, (userOverride ? { userOverride } : {})),
                    },
                    upsert: true,
                },
            });
        }
    }
    // Bulk upsert.
    if (upsertOps.length > 0) {
        yield collections_1.RecurringPatterns.bulkWrite(upsertOps, { ordered: false });
    }
    // Remove patterns that no longer have backing transactions (merchant key disappeared).
    const validKeys = new Set(upsertOps.map((op) => op.updateOne.filter.merchantKey));
    const stalePatterns = existingPatterns.filter((p) => !validKeys.has(p.merchantKey));
    if (stalePatterns.length > 0) {
        yield collections_1.RecurringPatterns.deleteMany({
            user_id,
            _id: { $in: stalePatterns.map((p) => p._id) },
            // Only delete patterns that weren't user-confirmed.
            'userOverride.confirmed': { $ne: true },
        }).exec();
    }
    (_h = (_g = config_1.default.log) === null || _g === void 0 ? void 0 : _g.info) === null || _h === void 0 ? void 0 : _h.call(_g, { user_id, patterns: upsertOps.length, stale: stalePatterns.length }, 'Pattern recompute done');
});
exports.recomputePatterns = recomputePatterns;
/**
 * Read persisted patterns for a user.
 */
const getPatterns = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    return collections_1.RecurringPatterns.find({ user_id })
        .sort({ confidence: -1 })
        .lean()
        .exec();
});
exports.getPatterns = getPatterns;
/**
 * Convert persisted patterns to the legacy RecurringGroup shape
 * so the existing FE contract stays unbroken.
 */
const getRecurringGroups = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    let patterns = yield (0, exports.getPatterns)(user_id);
    if (patterns.some((p) => !PATTERN_KEY_PREFIX_RE.test(p.merchantKey))) {
        yield (0, exports.recomputePatterns)(user_id);
        patterns = yield (0, exports.getPatterns)(user_id);
    }
    const activePatterns = patterns.filter((p) => { var _a; return !((_a = p.userOverride) === null || _a === void 0 ? void 0 : _a.disabled); });
    const recurringPatterns = activePatterns.filter((p) => {
        var _a, _b, _c;
        const effectiveFrequency = (_b = (_a = p.userOverride) === null || _a === void 0 ? void 0 : _a.customFrequency) !== null && _b !== void 0 ? _b : p.frequency;
        return ((_c = p.userOverride) === null || _c === void 0 ? void 0 : _c.confirmed) || (p.observed.occurrences >= frequency_detection_1.MIN_RECURRING_OCCURRENCES &&
            effectiveFrequency !== 'unknown' &&
            effectiveFrequency !== 'irregular');
    });
    return Promise.all(recurringPatterns.map((pattern) => patternToRecurringGroup(pattern)));
});
exports.getRecurringGroups = getRecurringGroups;
const hydrateRecurringTransactionItems = (p) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const occurrenceTxIds = (_a = p.observed.occurrenceTxIds) !== null && _a !== void 0 ? _a : [];
    if (!occurrenceTxIds.length) {
        return [];
    }
    const [bankTransactions, cardTransactions] = yield Promise.all([
        collections_1.Transactions.find({ _id: { $in: occurrenceTxIds } })
            .lean()
            .exec(),
        collections_1.CardTransactions.find({ _id: { $in: occurrenceTxIds } })
            .lean()
            .exec(),
    ]);
    const transactionsById = new Map();
    for (const transaction of [...bankTransactions, ...cardTransactions]) {
        transactionsById.set(transaction._id.toString(), transaction);
    }
    return occurrenceTxIds.reduce((items, id) => {
        var _a, _b, _c, _d;
        const transaction = transactionsById.get(id);
        if (!transaction) {
            return items;
        }
        const amount = (0, transaction_semantics_1.getTransactionAmount)(transaction);
        const eventDate = (0, transaction_semantics_1.getEventDate)(transaction);
        const postingDate = (0, transaction_semantics_1.getPostingDate)(transaction);
        items.push({
            _id: transaction._id.toString(),
            eventDate,
            postingDate,
            amount,
            description: (_b = (_a = transaction.description) !== null && _a !== void 0 ? _a : p.signals.descriptionVariants[0]) !== null && _b !== void 0 ? _b : '',
            companyId: (_d = (_c = transaction.companyId) !== null && _c !== void 0 ? _c : p.signals.companyIds[0]) !== null && _d !== void 0 ? _d : '',
            kind: amount >= 0 ? 'income' : 'expense',
            merchantId: (0, transaction_semantics_1.getMerchantId)(transaction),
            mcc: (0, transaction_semantics_1.getMcc)(transaction),
            counterparty: (0, transaction_semantics_1.getCounterparty)(transaction),
            providerCategoryName: (0, transaction_semantics_1.getProviderCategoryName)(transaction),
            cardLast4: (0, transaction_semantics_1.getCardLast4)(transaction),
            semanticType: (0, transaction_semantics_1.getSemanticType)(transaction),
        });
        return items;
    }, []);
});
const patternToRecurringGroup = (p) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const lastSeen = p.observed.lastSeen;
    const effectiveAmount = (_b = (_a = p.userOverride) === null || _a === void 0 ? void 0 : _a.customAmount) !== null && _b !== void 0 ? _b : p.amount.mean;
    const effectiveFreq = ((_d = (_c = p.userOverride) === null || _c === void 0 ? void 0 : _c.customFrequency) !== null && _d !== void 0 ? _d : p.frequency);
    const next = effectiveFreq !== 'unknown' && effectiveFreq !== 'irregular'
        ? (0, frequency_detection_1.nextUpcomingOccurrence)(lastSeen, effectiveFreq, p.anchor)
        : null;
    const effectiveClass = ((_f = (_e = p.userOverride) === null || _e === void 0 ? void 0 : _e.customClassification) !== null && _f !== void 0 ? _f : p.classification);
    const transactions = yield hydrateRecurringTransactionItems(p);
    return {
        description: (_g = p.signals.descriptionVariants[0]) !== null && _g !== void 0 ? _g : p.merchantKey,
        normalizedDescription: (0, normalization_1.normalize)((_h = p.signals.descriptionVariants[0]) !== null && _h !== void 0 ? _h : ''),
        kind: p.kind,
        amount: Math.round(effectiveAmount * 100) / 100,
        frequency: effectiveFreq,
        occurrences: p.observed.occurrences,
        nextExpected: next,
        totalSpent: Math.round(effectiveAmount * p.observed.occurrences * 100) / 100,
        transactions,
        patternId: (_j = p._id) === null || _j === void 0 ? void 0 : _j.toString(),
        classification: effectiveClass,
        confidence: p.confidence,
        anchor: p.anchor,
        installmentPlan: p.installmentPlan
            ? { paymentsRemaining: p.installmentPlan.paymentsRemaining, totalPayments: p.installmentPlan.totalPayments }
            : null,
        userOverride: p.userOverride
            ? { confirmed: p.userOverride.confirmed, disabled: p.userOverride.disabled }
            : null,
        merchantKey: p.merchantKey,
        source: p.source,
    };
});
/**
 * Apply a user override to a pattern.
 */
const overridePattern = (user_id, patternId, patch) => __awaiter(void 0, void 0, void 0, function* () {
    const update = {};
    for (const [key, val] of Object.entries(patch)) {
        update[`userOverride.${key}`] = val;
    }
    return collections_1.RecurringPatterns.findOneAndUpdate({ _id: patternId, user_id }, { $set: update }, { new: true }).exec();
});
exports.overridePattern = overridePattern;
// --- Internal helpers ---
/**
 * Estimate how many of the last N expected cycles were missed
 * (no matching transaction found within ±stddev window).
 */
function computeMissedCycles(dates, freqResult, lookbackCycles) {
    var _a;
    if (freqResult.freq === 'unknown' || dates.length < 2)
        return 0;
    const sorted = [...dates].sort();
    const last = sorted[sorted.length - 1];
    let missed = 0;
    // Walk backwards from the last observed date.
    let expected = last;
    for (let i = 0; i < lookbackCycles; i++) {
        // Go one cycle back.
        const prevExpected = goBackOneCycle(expected, freqResult);
        const tolerance = Math.max(3, ((_a = freqResult.anchor.stddevDays) !== null && _a !== void 0 ? _a : 2) * 2);
        // Check if any date falls within tolerance of prevExpected.
        const hit = sorted.some((d) => Math.abs(new Date(d).getTime() - new Date(prevExpected).getTime()) / 86400000 <= tolerance);
        if (!hit)
            missed++;
        expected = prevExpected;
    }
    return missed;
}
function goBackOneCycle(dateStr, freq) {
    var _a;
    const periodMap = {
        weekly: 7, biweekly: 14, monthly: 30, bimonthly: 60,
        quarterly: 91, semiannual: 182, annual: 365,
    };
    const days = (_a = periodMap[freq.freq]) !== null && _a !== void 0 ? _a : 30;
    return (0, date_helpers_1.addDays)(dateStr, -days);
}
