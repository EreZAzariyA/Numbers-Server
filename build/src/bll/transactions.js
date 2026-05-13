"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.invalidateUserDerivedCaches = exports.liveDetect = exports.detectRecurringTransactions = void 0;
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const models_1 = require("../models");
const collections_1 = require("../collections");
const helpers_1 = require("../utils/helpers");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
const normalization_1 = require("./recurring/normalization");
const frequency_detection_1 = require("./recurring/frequency-detection");
const settlement_detection_1 = require("../utils/settlement-detection");
const config_1 = __importDefault(require("../utils/config"));
const connectRedis_1 = require("../utils/connectRedis");
const transaction_semantics_1 = require("../utils/transaction-semantics");
// Lazy-loaded so the module is safe to import before Mongoose/BullMQ are wired up.
const invalidateUserDerivedCaches = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    yield Promise.all([
        cache_service_1.default.del(`cashFlow:${user_id}`),
        cache_service_1.default.del(`forecast:${user_id}`),
        cache_service_1.default.del(`financialHealth:${user_id}`),
        cache_service_1.default.del(`patterns:${user_id}`),
    ]);
});
exports.invalidateUserDerivedCaches = invalidateUserDerivedCaches;
const enqueuePatternRecomputeSafe = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    if (!config_1.default.enablePatternPersistence || !(0, connectRedis_1.isRedisAvailable)())
        return;
    try {
        // Dynamic import keeps BullMQ queue creation lazy; avoids module-init cycles
        // when this file is imported before queues/index.ts has initialised Redis.
        const { enqueuePatternRecompute } = yield Promise.resolve().then(() => __importStar(require('../queues')));
        yield enqueuePatternRecompute(user_id);
    }
    catch (err) {
        (_b = (_a = config_1.default.log) === null || _a === void 0 ? void 0 : _a.warn) === null || _b === void 0 ? void 0 : _b.call(_a, { err: err.message, user_id }, 'Failed to enqueue pattern recompute');
    }
});
class TransactionsLogic {
    constructor() {
        this.fetchUserTransactions = (user_id, params, type) => __awaiter(this, void 0, void 0, function* () {
            const { query, projection, options } = params;
            const collection = type === 'creditCards' ? collections_1.CardTransactions : collections_1.Transactions;
            let transactions = [];
            let total = 0;
            total = yield collection.countDocuments(Object.assign({ user_id }, query));
            transactions = yield collection.find(Object.assign({ user_id }, query), projection, Object.assign(Object.assign({}, options), { sort: { 'eventDate': -1, 'date': -1 } }));
            return {
                transactions,
                total
            };
        });
        this.fetchUserBankTransaction = (transaction, companyId, user_id) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const isCardTransaction = (0, helpers_1.isCardProviderCompany)(companyId);
            let trans = undefined;
            const query = Object.assign({}, ((transaction === null || transaction === void 0 ? void 0 : transaction.identifier) ? {
                identifier: isCardTransaction ? transaction.identifier.toString() : transaction.identifier
            } : Object.assign(Object.assign(Object.assign({}, ((transaction === null || transaction === void 0 ? void 0 : transaction.memo) ? {
                memo: transaction.memo
            } : {})), ((0, transaction_semantics_1.getEventDate)(transaction) ? {
                eventDate: (0, transaction_semantics_1.getEventDate)(transaction)
            } : {})), { companyId, description: transaction.description, amount: (_a = transaction.chargedAmount) !== null && _a !== void 0 ? _a : transaction.originalAmount })));
            let collection = collections_1.Transactions;
            if (isCardTransaction) {
                collection = collections_1.CardTransactions;
            }
            trans = yield collection.findOne(Object.assign({ user_id }, query)).exec();
            return trans;
        });
        this.newTransaction = (user_id, transaction, type) => __awaiter(this, void 0, void 0, function* () {
            if (!user_id) {
                throw new models_1.ClientError(500, 'User id is missing');
            }
            const isCardTransaction = (0, helpers_1.isCardProviderCompany)(transaction.companyId) || type !== 'transactions';
            let newTransaction = null;
            if (isCardTransaction) {
                newTransaction = new collections_1.CardTransactions(Object.assign({ user_id, cardNumber: (0, transaction_semantics_1.getCardLast4)(transaction) || null, cardLast4: (0, transaction_semantics_1.getCardLast4)(transaction) || null }, transaction));
            }
            else {
                newTransaction = new collections_1.Transactions(Object.assign({ user_id }, transaction));
            }
            const errors = newTransaction.validateSync();
            if (errors) {
                throw new models_1.ClientError(500, errors.message);
            }
            const savedTransaction = yield newTransaction.save();
            yield invalidateUserDerivedCaches(user_id);
            yield enqueuePatternRecomputeSafe(user_id);
            return savedTransaction;
        });
        this.updateTransaction = (user_id_1, transaction_1, ...args_1) => __awaiter(this, [user_id_1, transaction_1, ...args_1], void 0, function* (user_id, transaction, type = 'Account') {
            const isCardTransaction = type !== 'transactions';
            const collection = isCardTransaction ? collections_1.CardTransactions : collections_1.Transactions;
            const currentTransaction = yield collection.findOne({ user_id, _id: transaction._id }).exec();
            if (!currentTransaction) {
                throw new models_1.ClientError(400, 'User transaction not found');
            }
            const updatedTransaction = yield collection.findOneAndUpdate({ user_id, _id: transaction._id }, {
                $set: Object.assign(Object.assign({}, transaction), { eventDate: (0, transaction_semantics_1.getEventDate)(transaction), postingDate: (0, transaction_semantics_1.getPostingDate)(transaction), date: (0, transaction_semantics_1.getEventDate)(transaction), processedDate: (0, transaction_semantics_1.getPostingDate)(transaction), category_id: transaction.category_id, description: transaction.description, amount: transaction.amount, status: transaction.status || transactions_1.TransactionStatuses.Completed })
            }, { new: true }).exec();
            const errors = updatedTransaction.validateSync();
            if (errors) {
                throw new models_1.ClientError(500, errors.message);
            }
            yield invalidateUserDerivedCaches(user_id);
            yield enqueuePatternRecomputeSafe(user_id);
            return updatedTransaction;
        });
        this.updateTransactionStatus = (transaction, status) => __awaiter(this, void 0, void 0, function* () {
            const isCardProvider = (0, helpers_1.isCardProviderCompany)(transaction.companyId);
            if (isCardProvider) {
                return yield collections_1.CardTransactions.findByIdAndUpdate(transaction._id, { $set: { status } }, { new: true }).exec();
            }
            return yield collections_1.Transactions.findByIdAndUpdate(transaction._id, { $set: { status } }, { new: true }).exec();
        });
        this.removeTransaction = (user_id_1, transaction_id_1, ...args_1) => __awaiter(this, [user_id_1, transaction_id_1, ...args_1], void 0, function* (user_id, transaction_id, type = 'transactions') {
            const isCardTransaction = type !== 'transactions';
            const query = { user_id, _id: transaction_id };
            try {
                if (isCardTransaction) {
                    yield collections_1.CardTransactions.findOneAndDelete(query).exec();
                }
                else {
                    yield collections_1.Transactions.findOneAndDelete(query).exec();
                }
                yield invalidateUserDerivedCaches(user_id);
                yield enqueuePatternRecomputeSafe(user_id);
            }
            catch (err) {
                console.log(err);
            }
        });
    }
}
;
const clusterByAmount = (items) => {
    const clusters = [];
    for (const item of items) {
        const matched = clusters.find((c) => {
            const avg = c.reduce((s, x) => s + x.absoluteAmount, 0) / c.length;
            return Math.abs(item.absoluteAmount - avg) / Math.max(avg, 1) <= 0.05;
        });
        if (matched) {
            matched.push(item);
        }
        else {
            clusters.push([item]);
        }
    }
    return clusters;
};
/**
 * DOM-anchored frequency detection.
 * Computes modal day-of-month; if concentration is high we snap nextExpected to
 * that DOM in the next month. Otherwise falls back to lastDate + periodDays.
 */
const detectFrequency = (items) => {
    const sorted = [...items].sort((a, b) => new Date(a.postingDate).getTime() - new Date(b.postingDate).getTime());
    if (sorted.length < frequency_detection_1.MIN_RECURRING_OCCURRENCES)
        return { frequency: 'irregular', nextExpected: null };
    const dates = sorted.map((item) => item.postingDate);
    const lastDate = sorted[sorted.length - 1].postingDate;
    const result = (0, frequency_detection_1.detectFrequency)(dates);
    if (result.freq === 'unknown' || result.freq === 'irregular') {
        return { frequency: 'irregular', nextExpected: null, anchor: result.anchor };
    }
    return {
        frequency: result.freq,
        nextExpected: (0, frequency_detection_1.nextUpcomingOccurrence)(lastDate, result.freq, result.anchor),
        anchor: result.anchor,
    };
};
const getRecurringKind = (amount) => amount >= 0 ? 'income' : 'expense';
const isInstallmentLike = (transaction) => { var _a; return (transaction === null || transaction === void 0 ? void 0 : transaction.type) === transactions_1.TransactionTypes.Installments || Boolean((_a = transaction === null || transaction === void 0 ? void 0 : transaction.installments) === null || _a === void 0 ? void 0 : _a.total); };
const isSettlementRecurringGroup = (group) => { var _a, _b; return (0, settlement_detection_1.classifySettlement)((_b = (_a = group.description) !== null && _a !== void 0 ? _a : group.normalizedDescription) !== null && _b !== void 0 ? _b : '', false) !== 'normal'; };
const isRecurringGroupValid = (group) => {
    var _a;
    return !isSettlementRecurringGroup(group) && (Boolean((_a = group.userOverride) === null || _a === void 0 ? void 0 : _a.confirmed) || (group.occurrences >= frequency_detection_1.MIN_RECURRING_OCCURRENCES &&
        group.frequency !== 'unknown' &&
        group.frequency !== 'irregular'));
};
const hasLegacyPatternKey = (group) => Boolean(group.merchantKey) && !/^(bank|card):(income|expense):/.test(group.merchantKey);
const getGroupOccurrenceDates = (group, dateBasis) => {
    var _a, _b;
    return (_b = (_a = group.transactions) === null || _a === void 0 ? void 0 : _a.map((transaction) => {
        if (dateBasis === 'event') {
            return transaction.eventDate || transaction.postingDate;
        }
        return transaction.postingDate || transaction.eventDate;
    }).filter(Boolean).sort()) !== null && _b !== void 0 ? _b : [];
};
const getNextExpectedForGroup = (group, referenceDate, dateBasis) => {
    if (!group.frequency || group.frequency === 'unknown' || group.frequency === 'irregular') {
        return group.nextExpected;
    }
    const occurrenceDates = getGroupOccurrenceDates(group, dateBasis);
    const lastSeen = occurrenceDates[occurrenceDates.length - 1];
    if (!lastSeen) {
        return group.nextExpected;
    }
    let anchor = group.anchor;
    const recalculated = (0, frequency_detection_1.detectFrequency)(occurrenceDates);
    if (recalculated.freq !== 'unknown' && recalculated.freq !== 'irregular') {
        anchor = recalculated.anchor;
    }
    if (!anchor) {
        return group.nextExpected;
    }
    return (0, frequency_detection_1.nextUpcomingOccurrence)(lastSeen, group.frequency, anchor, referenceDate);
};
const liveDetect = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    const since = new Date();
    since.setMonth(since.getMonth() - 12);
    const sinceStr = since.toISOString().slice(0, 10); // "YYYY-MM-DD" — date field is stored as string
    const [regularTxns, cardTxns] = yield Promise.all([
        collections_1.Transactions.find({ user_id, status: transactions_1.TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
        collections_1.CardTransactions.find({ user_id, status: transactions_1.TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
    ]);
    // Settlement rows should never become recurring spending patterns, even if
    // they are the only card-payment signal available in the bank ledger.
    const hasCardData = cardTxns.length > 0;
    const settlementTreatments = (0, settlement_detection_1.buildSettlementTreatmentMap)(regularTxns, cardTxns);
    const all = [...regularTxns, ...cardTxns].map((t) => {
        var _a, _b;
        return ({
            _id: t._id.toString(),
            eventDate: (0, transaction_semantics_1.getEventDate)(t),
            postingDate: (0, transaction_semantics_1.getPostingDate)(t),
            amount: (0, transaction_semantics_1.getTransactionAmount)(t),
            absoluteAmount: Math.abs((0, transaction_semantics_1.getTransactionAmount)(t)),
            description: (_a = t.description) !== null && _a !== void 0 ? _a : '',
            normalizedSource: (0, transaction_semantics_1.getTransactionTextSource)(t),
            companyId: (_b = t.companyId) !== null && _b !== void 0 ? _b : '',
            kind: getRecurringKind((0, transaction_semantics_1.getTransactionAmount)(t)),
            source: ((0, helpers_1.isCardProviderCompany)(t.companyId) ? 'card' : 'bank'),
            type: t.type,
            installments: t.installments,
        });
    }).filter((t) => {
        var _a;
        return t.absoluteAmount > 0 &&
            !isInstallmentLike(t) &&
            ((_a = settlementTreatments.get(t._id)) !== null && _a !== void 0 ? _a : (0, settlement_detection_1.classifySettlement)(t.description, hasCardData)) === 'normal';
    });
    // Group by (source, kind, normalized description) so bank and card stay separate.
    const byNorm = new Map();
    for (const t of all) {
        const normalizedDescription = (0, normalization_1.normalize)(t.normalizedSource);
        if (!normalizedDescription)
            continue;
        const key = `${t.source}:${t.kind}:${(0, normalization_1.descriptionKey)(t.normalizedSource)}`;
        if (!byNorm.has(key))
            byNorm.set(key, []);
        byNorm.get(key).push(t);
    }
    const groups = [];
    for (const [, items] of byNorm) {
        const clusters = clusterByAmount(items);
        for (const cluster of clusters) {
            if (cluster.length < frequency_detection_1.MIN_RECURRING_OCCURRENCES)
                continue;
            const months = new Set(cluster.map((t) => t.postingDate.slice(0, 7)));
            if (months.size < 2)
                continue;
            const avgAmount = cluster.reduce((s, t) => s + t.absoluteAmount, 0) / cluster.length;
            const totalSpent = cluster.reduce((s, t) => s + t.absoluteAmount, 0);
            const { frequency, nextExpected, anchor } = detectFrequency(cluster);
            if (frequency === 'irregular')
                continue;
            const source = cluster[0].source;
            groups.push({
                description: cluster[0].description,
                normalizedDescription: (0, normalization_1.normalize)(cluster[0].normalizedSource),
                kind: cluster[0].kind,
                amount: Math.round(avgAmount * 100) / 100,
                frequency,
                occurrences: cluster.length,
                nextExpected,
                totalSpent: Math.round(totalSpent * 100) / 100,
                transactions: cluster,
                anchor,
                source,
                merchantKey: `desc:${(0, normalization_1.descriptionKey)(cluster[0].normalizedSource)}`,
            });
        }
    }
    return groups.sort((a, b) => b.totalSpent - a.totalSpent);
});
exports.liveDetect = liveDetect;
/**
 * Recompute `nextExpected` for each group relative to today.
 * This prevents stale dates when groups are served from cache.
 */
const refreshNextExpected = (groups, dateBasis = 'settlement') => {
    const today = new Date().toISOString().slice(0, 10);
    return groups.map((group) => {
        if (!group.frequency || group.frequency === 'unknown' || group.frequency === 'irregular') {
            return group;
        }
        const next = getNextExpectedForGroup(group, today, dateBasis);
        return Object.assign(Object.assign({}, group), { nextExpected: next !== null && next !== void 0 ? next : group.nextExpected });
    });
};
const detectRecurringTransactions = (user_id_1, ...args_1) => __awaiter(void 0, [user_id_1, ...args_1], void 0, function* (user_id, options = {}) {
    var _a, _b, _c;
    const dateBasis = (_a = options.dateBasis) !== null && _a !== void 0 ? _a : 'settlement';
    if (!config_1.default.enablePatternPersistence) {
        const groups = yield liveDetect(user_id);
        return refreshNextExpected(groups, dateBasis);
    }
    // Persistence path — serve from cache → DB → live-detect with async recompute.
    try {
        const cached = yield cache_service_1.default.get(`patterns:${user_id}`);
        if (cached) {
            if (cached.some(hasLegacyPatternKey)) {
                yield cache_service_1.default.del(`patterns:${user_id}`);
            }
            else {
                const filteredCached = cached.filter(isRecurringGroupValid);
                if (filteredCached.length !== cached.length) {
                    yield cache_service_1.default.set(`patterns:${user_id}`, filteredCached, 600);
                }
                return refreshNextExpected(filteredCached, dateBasis);
            }
        }
        const { getRecurringGroups } = yield Promise.resolve().then(() => __importStar(require('./recurring/pattern-service')));
        const groups = (yield getRecurringGroups(user_id)).filter(isRecurringGroupValid);
        if (groups && groups.length > 0) {
            yield cache_service_1.default.set(`patterns:${user_id}`, groups, 600);
            return refreshNextExpected(groups, dateBasis);
        }
        // Empty persisted state — fall back to live detection + async seed.
        const live = yield liveDetect(user_id);
        yield enqueuePatternRecomputeSafe(user_id);
        return refreshNextExpected(live, dateBasis);
    }
    catch (err) {
        (_c = (_b = config_1.default.log) === null || _b === void 0 ? void 0 : _b.warn) === null || _c === void 0 ? void 0 : _c.call(_b, { err: err.message, user_id }, 'Persisted pattern read failed; falling back to live detect');
        const live = yield liveDetect(user_id);
        return refreshNextExpected(live, dateBasis);
    }
});
exports.detectRecurringTransactions = detectRecurringTransactions;
const transactionsLogic = new TransactionsLogic();
exports.default = transactionsLogic;
