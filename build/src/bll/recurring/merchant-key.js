"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signalCorroborationRatio = exports.agreesOn = exports.buildMerchantKey = void 0;
const normalization_1 = require("./normalization");
const transaction_semantics_1 = require("../../utils/transaction-semantics");
/**
 * Build a deterministic composite key that groups transactions from the same
 * "logical merchant" while keeping structurally-different entities separate
 * (e.g. Shufersal branch 124 vs 507).
 *
 * Hierarchy:
 *  1. merchantId from raw (most reliable)
 *  2. mcc + companyId + normalized description
 *  3. companyId + memo
 *  4. companyId + normalized description
 *  5. normalized description with trailing digits stripped (fallback)
 */
const buildMerchantKey = (tx) => {
    const merchantId = (0, transaction_semantics_1.getMerchantId)(tx);
    const mcc = (0, transaction_semantics_1.getMcc)(tx);
    const counterparty = (0, transaction_semantics_1.getCounterparty)(tx);
    const cardLast4 = (0, transaction_semantics_1.getCardLast4)(tx);
    const descriptionFallback = tx.description || counterparty || (0, transaction_semantics_1.getProviderCategoryName)(tx) || '';
    const normalizedDescriptionKey = (0, normalization_1.stripTrailingDigits)((0, normalization_1.normalize)(descriptionFallback));
    if (merchantId) {
        return `mid:${merchantId}`;
    }
    if (mcc && tx.companyId) {
        return `mcc:${tx.companyId}:${mcc}:${(0, normalization_1.normalize)(tx.description)}`;
    }
    if (cardLast4 && normalizedDescriptionKey) {
        return `card:${cardLast4}:${normalizedDescriptionKey}`;
    }
    if (tx.companyId && counterparty) {
        return `cp:${tx.companyId}:${(0, normalization_1.normalize)(counterparty)}`;
    }
    if (tx.companyId && normalizedDescriptionKey) {
        return `cd:${tx.companyId}:${normalizedDescriptionKey}`;
    }
    return `desc:${normalizedDescriptionKey}`;
};
exports.buildMerchantKey = buildMerchantKey;
/**
 * Signal corroboration: two transactions should share a pattern only if
 * at least `minSignals` of their structured signals agree.
 * This prevents e.g. two Shufersal branches from merging just because
 * they share a stripped description.
 */
const firstToken = (s) => {
    const n = (0, normalization_1.normalize)(s);
    return n ? n.split(' ')[0] : undefined;
};
const agreesOn = (a, b, minSignals = 2) => {
    var _a, _b, _c;
    let count = 0;
    if (a.companyId && a.companyId === b.companyId)
        count++;
    if (a.category_id && a.category_id.toString() === ((_a = b.category_id) === null || _a === void 0 ? void 0 : _a.toString()))
        count++;
    if ((0, transaction_semantics_1.getCounterparty)(a) && (0, transaction_semantics_1.getCounterparty)(a) === (0, transaction_semantics_1.getCounterparty)(b))
        count++;
    if ((0, transaction_semantics_1.getMcc)(a) && (0, transaction_semantics_1.getMcc)(a) === (0, transaction_semantics_1.getMcc)(b))
        count++;
    if ((0, transaction_semantics_1.getMerchantId)(a) && (0, transaction_semantics_1.getMerchantId)(a) === (0, transaction_semantics_1.getMerchantId)(b))
        count++;
    const aFirst = firstToken((_b = a.description) !== null && _b !== void 0 ? _b : '');
    const bFirst = firstToken((_c = b.description) !== null && _c !== void 0 ? _c : '');
    if (aFirst && aFirst === bFirst)
        count++;
    return count >= minSignals;
};
exports.agreesOn = agreesOn;
/**
 * Count how many of the signal fields are non-empty and consistent across
 * a set of transactions. Returns a ratio 0..1 used in confidence scoring.
 */
const signalCorroborationRatio = (signals) => {
    const fields = [
        signals.companyIds,
        signals.categoryIds,
        signals.channels,
        signals.descriptionVariants,
        signals.memoVariants,
    ];
    let populated = 0;
    let consistent = 0;
    for (const arr of fields) {
        if (!arr || arr.length === 0)
            continue;
        populated++;
        const unique = new Set(arr);
        if (unique.size === 1)
            consistent++;
    }
    return populated === 0 ? 0 : consistent / populated;
};
exports.signalCorroborationRatio = signalCorroborationRatio;
