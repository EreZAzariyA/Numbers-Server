"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDateForBasis = exports.getTransactionTextSource = exports.isSemanticSettlement = exports.getSemanticType = exports.inferLegacySemanticType = exports.getCardUniqueId = exports.getCardLast4 = exports.getMcc = exports.getMerchantId = exports.getCounterparty = exports.getProviderCategoryName = exports.getBillingDate = exports.getPostingDate = exports.getEventDate = exports.getTransactionAmount = void 0;
const date_helpers_1 = require("./date-helpers");
const toDateString = (value) => (value ? (0, date_helpers_1.toDateStr)(value) : '');
const getTransactionAmount = (transaction) => { var _a, _b, _c; return (_c = (_b = (_a = transaction.amount) !== null && _a !== void 0 ? _a : transaction.chargedAmount) !== null && _b !== void 0 ? _b : transaction.originalAmount) !== null && _c !== void 0 ? _c : 0; };
exports.getTransactionAmount = getTransactionAmount;
const getEventDate = (transaction) => {
    var _a, _b, _c;
    return toDateString((_c = (_b = (_a = transaction.eventDate) !== null && _a !== void 0 ? _a : transaction.date) !== null && _b !== void 0 ? _b : transaction.postingDate) !== null && _c !== void 0 ? _c : transaction.processedDate);
};
exports.getEventDate = getEventDate;
const getPostingDate = (transaction) => {
    var _a, _b, _c;
    return toDateString((_c = (_b = (_a = transaction.postingDate) !== null && _a !== void 0 ? _a : transaction.processedDate) !== null && _b !== void 0 ? _b : transaction.eventDate) !== null && _c !== void 0 ? _c : transaction.date);
};
exports.getPostingDate = getPostingDate;
const getBillingDate = (transaction) => toDateString(transaction.billingDate);
exports.getBillingDate = getBillingDate;
const getProviderCategoryName = (transaction) => {
    var _a, _b, _c;
    return (_c = (_b = (_a = transaction.providerCategoryName) !== null && _a !== void 0 ? _a : transaction.category) !== null && _b !== void 0 ? _b : transaction.categoryDescription) !== null && _c !== void 0 ? _c : '';
};
exports.getProviderCategoryName = getProviderCategoryName;
const getCounterparty = (transaction) => {
    var _a, _b, _c, _d;
    return (_d = (_c = (_b = (_a = transaction.counterparty) !== null && _a !== void 0 ? _a : transaction.memo) !== null && _b !== void 0 ? _b : transaction.channelName) !== null && _c !== void 0 ? _c : transaction.channel) !== null && _d !== void 0 ? _d : '';
};
exports.getCounterparty = getCounterparty;
const getMerchantId = (transaction) => {
    var _a, _b, _c, _d, _e;
    return (_e = (_c = (_a = transaction.merchantId) !== null && _a !== void 0 ? _a : (_b = transaction.rawTransaction) === null || _b === void 0 ? void 0 : _b.merchantId) !== null && _c !== void 0 ? _c : (_d = transaction.rawTransaction) === null || _d === void 0 ? void 0 : _d.merchantID) !== null && _e !== void 0 ? _e : '';
};
exports.getMerchantId = getMerchantId;
const getMcc = (transaction) => {
    var _a, _b, _c;
    return (_c = (_a = transaction.mcc) !== null && _a !== void 0 ? _a : (_b = transaction.rawTransaction) === null || _b === void 0 ? void 0 : _b.mcc) !== null && _c !== void 0 ? _c : null;
};
exports.getMcc = getMcc;
const getCardLast4 = (transaction) => { var _a, _b; return String((_b = (_a = transaction.cardLast4) !== null && _a !== void 0 ? _a : transaction.cardNumber) !== null && _b !== void 0 ? _b : '').trim(); };
exports.getCardLast4 = getCardLast4;
const getCardUniqueId = (transaction) => { var _a, _b, _c; return (_c = (_a = transaction.cardUniqueId) !== null && _a !== void 0 ? _a : (_b = transaction.rawTransaction) === null || _b === void 0 ? void 0 : _b.cardUniqueId) !== null && _c !== void 0 ? _c : ''; };
exports.getCardUniqueId = getCardUniqueId;
const inferLegacySemanticType = (transaction) => {
    var _a, _b, _c;
    const amount = (0, exports.getTransactionAmount)(transaction);
    const category = (0, exports.getProviderCategoryName)(transaction).toLowerCase();
    const description = (0, exports.getTransactionTextSource)(transaction).toLowerCase();
    if ((_a = transaction.rawTransaction) === null || _a === void 0 ? void 0 : _a.mcc) {
        return amount >= 0 ? 'refund' : 'merchant_charge';
    }
    if (((_b = transaction.rawTransaction) === null || _b === void 0 ? void 0 : _b.merchantId) || ((_c = transaction.rawTransaction) === null || _c === void 0 ? void 0 : _c.merchantID)) {
        return amount >= 0 ? 'refund' : 'merchant_charge';
    }
    if (category.includes('הוראת קבע') || description.includes('הוראת קבע')) {
        return 'standing_order';
    }
    if (category.includes('עמלה') || description.includes('עמלה')) {
        return 'bank_fee';
    }
    if (amount >= 0) {
        return 'deposit';
    }
    return 'bank_transfer';
};
exports.inferLegacySemanticType = inferLegacySemanticType;
const getSemanticType = (transaction) => { var _a; return (_a = transaction.semanticType) !== null && _a !== void 0 ? _a : (0, exports.inferLegacySemanticType)(transaction); };
exports.getSemanticType = getSemanticType;
const isSemanticSettlement = (transaction) => (0, exports.getSemanticType)(transaction) === 'card_settlement';
exports.isSemanticSettlement = isSemanticSettlement;
const getTransactionTextSource = (transaction) => [
    transaction.description,
    transaction.memo,
    (0, exports.getProviderCategoryName)(transaction),
    (0, exports.getCounterparty)(transaction),
].filter(Boolean).join(' ');
exports.getTransactionTextSource = getTransactionTextSource;
const getDateForBasis = (transaction, basis = 'posting') => {
    return basis === 'event' ? (0, exports.getEventDate)(transaction) : (0, exports.getPostingDate)(transaction);
};
exports.getDateForBasis = getDateForBasis;
