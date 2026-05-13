"use strict";
/**
 * Credit-card settlement detection.
 *
 * Israeli bank statements often include a single monthly debit that represents
 * the total credit-card bill ("הסדר כרטיס אשראי").  When we also have the
 * individual card transactions in `CardTransactions`, counting the settlement
 * too leads to double-counted spending.
 *
 * This module identifies those settlement transactions so callers can either
 * exclude them (when granular card data exists) or mark them as low-confidence
 * spending (when it does not).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSettlementTreatmentMap = exports.classifySettlement = exports.isSettlementDescription = exports.getSettlementTextSource = void 0;
const normalization_1 = require("../bll/recurring/normalization");
const date_helpers_1 = require("./date-helpers");
const transaction_semantics_1 = require("./transaction-semantics");
// ── Hebrew patterns commonly found in bank-statement settlement rows ────────
const SETTLEMENT_PATTERNS_HE = [
    'הסדר כרטיס',
    'הסדר כ אשראי',
    'תשלום כרטיס אשראי',
    'תשלום לכרטיס',
    'חיוב כרטיס אשראי',
    'חיוב כרטיס',
    'חיוב אשראי',
    'סליקת כרטיס',
    'כ אשראי חיוב',
];
// ── English patterns ────────────────────────────────────────────────────────
const SETTLEMENT_PATTERNS_EN = [
    'credit card payment',
    'card settlement',
    'cc payment',
    'credit card settlement',
    'card charge settlement',
];
// ── Card-issuer brand names that appear in settlement descriptions ──────────
const CARD_ISSUER_KEYWORDS = [
    'ויזה', 'visa',
    'מסטרקרד', 'mastercard',
    'ישראכרט', 'isracard',
    'כאל', 'cal',
    'מקס', 'max',
    'לאומי קארד', 'leumi card',
    'דיינרס', 'diners',
    'אמריקן אקספרס', 'amex', 'american express',
];
// Pre-compute normalized versions once at module load.
const NORMALIZED_SETTLEMENT = [
    ...SETTLEMENT_PATTERNS_HE,
    ...SETTLEMENT_PATTERNS_EN,
].map(normalization_1.normalize);
const NORMALIZED_ISSUER_KW = CARD_ISSUER_KEYWORDS.map(normalization_1.normalize);
const PROVIDER_ALIAS_GROUPS = [
    { issuer: 'cal', aliases: ['כאל', 'cal', 'visa cal', 'visacal', 'leumi card', 'לאומי קארד'] },
    { issuer: 'max', aliases: ['מקס', 'max', 'maxcard'] },
    { issuer: 'isracard', aliases: ['ישראכרט', 'isracard', 'behatsdaa', 'בהצדעה'] },
];
const ROUNDING_TOLERANCE = 1;
const STATEMENT_MATCH_TOLERANCE = 0.08;
const STATEMENT_MATCH_TOLERANCE_WITH_HINT = 0.12;
const MIN_CONTEXTUAL_SETTLEMENT_AMOUNT = 250;
const MIN_STRONG_CONTEXTUAL_SETTLEMENT_AMOUNT = 500;
const MIN_CARD_STATEMENT_AMOUNT = 100;
const MIN_DATE_GAP_DAYS = -3;
const MAX_DATE_GAP_DAYS = 25;
const getTransactionId = (transaction) => {
    if (!(transaction === null || transaction === void 0 ? void 0 : transaction._id))
        return '';
    return typeof transaction._id === 'string'
        ? transaction._id
        : transaction._id.toString();
};
const getTransactionDate = (transaction) => {
    const source = (0, transaction_semantics_1.getPostingDate)(transaction);
    return source ? (0, date_helpers_1.toDateStr)(source) : '';
};
const getSettlementTextSource = (transaction) => (0, transaction_semantics_1.getTransactionTextSource)(transaction);
exports.getSettlementTextSource = getSettlementTextSource;
const getMonthEnd = (month) => {
    const [year, monthPart] = month.split('-').map(Number);
    return (0, date_helpers_1.ymd)(year, monthPart - 1, 31);
};
const getIssuerFromCompanyId = (companyId) => {
    const norm = (0, normalization_1.normalize)(companyId !== null && companyId !== void 0 ? companyId : '');
    if (!norm)
        return null;
    for (const group of PROVIDER_ALIAS_GROUPS) {
        if (group.aliases.some((alias) => norm.includes((0, normalization_1.normalize)(alias)))) {
            return group.issuer;
        }
    }
    return null;
};
const getIssuerHintFromText = (text) => {
    const norm = (0, normalization_1.normalize)(text);
    if (!norm)
        return null;
    for (const group of PROVIDER_ALIAS_GROUPS) {
        if (group.aliases.some((alias) => norm.includes((0, normalization_1.normalize)(alias)))) {
            return group.issuer;
        }
    }
    return null;
};
const isRoundedSettlementAmount = (amount) => {
    const absoluteAmount = Math.abs(amount);
    if (absoluteAmount < MIN_CONTEXTUAL_SETTLEMENT_AMOUNT)
        return false;
    const nearestTen = Math.round(absoluteAmount / 10) * 10;
    const nearestFifty = Math.round(absoluteAmount / 50) * 50;
    return (Math.abs(absoluteAmount - nearestTen) <= ROUNDING_TOLERANCE ||
        Math.abs(absoluteAmount - nearestFifty) <= ROUNDING_TOLERANCE);
};
const buildStatementTotals = (cardTransactions) => {
    var _a;
    const totals = new Map();
    for (const transaction of cardTransactions) {
        if ((0, transaction_semantics_1.getSemanticType)(transaction) === 'card_settlement') {
            continue;
        }
        const issuer = getIssuerFromCompanyId(transaction.companyId);
        if (!issuer)
            continue;
        const date = getTransactionDate(transaction);
        if (!date)
            continue;
        const amount = (0, transaction_semantics_1.getTransactionAmount)(transaction);
        if (amount === 0)
            continue;
        const month = date.slice(0, 7);
        const key = `${issuer}:${month}`;
        totals.set(key, ((_a = totals.get(key)) !== null && _a !== void 0 ? _a : 0) + amount);
    }
    return Array.from(totals.entries())
        .map(([key, signedAmount]) => {
        const [issuer, month] = key.split(':');
        const amount = Math.abs(Math.min(signedAmount, 0));
        return {
            issuer,
            month,
            monthEnd: getMonthEnd(month),
            amount,
        };
    })
        .filter((statement) => statement.amount >= MIN_CARD_STATEMENT_AMOUNT);
};
const findStrongContextualMatch = (transaction, statements) => {
    const amount = (0, transaction_semantics_1.getTransactionAmount)(transaction);
    const absoluteAmount = Math.abs(amount);
    const date = getTransactionDate(transaction);
    const textSource = (0, exports.getSettlementTextSource)(transaction);
    const issuerHint = getIssuerHintFromText(textSource);
    const hasTextHint = (0, exports.isSettlementDescription)(textSource);
    if (!date || absoluteAmount < MIN_CONTEXTUAL_SETTLEMENT_AMOUNT) {
        return false;
    }
    for (const statement of statements) {
        if (issuerHint && statement.issuer !== issuerHint)
            continue;
        const dateGap = (0, date_helpers_1.diffDays)(statement.monthEnd, date);
        if (dateGap < MIN_DATE_GAP_DAYS || dateGap > MAX_DATE_GAP_DAYS)
            continue;
        const amountDiffRatio = Math.abs(absoluteAmount - statement.amount) / Math.max(statement.amount, 1);
        const amountTolerance = issuerHint || hasTextHint
            ? STATEMENT_MATCH_TOLERANCE_WITH_HINT
            : STATEMENT_MATCH_TOLERANCE;
        if (amountDiffRatio > amountTolerance)
            continue;
        if (hasTextHint)
            return true;
        if (issuerHint && absoluteAmount >= MIN_CONTEXTUAL_SETTLEMENT_AMOUNT)
            return true;
        if (absoluteAmount >= MIN_STRONG_CONTEXTUAL_SETTLEMENT_AMOUNT)
            return true;
        if (isRoundedSettlementAmount(absoluteAmount))
            return true;
    }
    return false;
};
/**
 * Check whether a transaction description looks like a credit-card settlement.
 */
const isSettlementDescription = (description) => {
    const norm = (0, normalization_1.normalize)(description);
    if (!norm)
        return false;
    // Direct match against known settlement phrases.
    if (NORMALIZED_SETTLEMENT.some((p) => norm.includes(p)))
        return true;
    // Heuristic: description contains a card-issuer keyword AND a payment-like
    // verb (Hebrew: "תשלום", "חיוב", "הסדר"; English: "payment", "charge").
    const paymentVerbs = ['תשלום', 'חיוב', 'הסדר', 'payment', 'charge', 'settlement'];
    const hasIssuer = NORMALIZED_ISSUER_KW.some((kw) => norm.includes(kw));
    const hasVerb = paymentVerbs.some((v) => norm.includes(v));
    if (hasIssuer && hasVerb)
        return true;
    return false;
};
exports.isSettlementDescription = isSettlementDescription;
/**
 * Classify a transaction as settlement / normal.
 *
 * @param description  Raw transaction description.
 * @param hasCardData  Whether the user has *any* card transactions in the
 *                     relevant period.  When true, individual card charges
 *                     already cover the spending and the settlement is pure
 *                     double-counting.
 */
const classifySettlement = (description, hasCardData) => {
    if (!(0, exports.isSettlementDescription)(description))
        return 'normal';
    return hasCardData ? 'exclude' : 'low-confidence';
};
exports.classifySettlement = classifySettlement;
const buildSettlementTreatmentMap = (bankTransactions, cardTransactions) => {
    const hasCardData = cardTransactions.length > 0;
    const treatments = new Map();
    if (!hasCardData) {
        for (const transaction of bankTransactions) {
            const id = getTransactionId(transaction);
            if (!id)
                continue;
            const textSource = (0, exports.getSettlementTextSource)(transaction);
            const treatment = (0, exports.classifySettlement)(textSource, false);
            if (treatment !== 'normal') {
                treatments.set(id, treatment);
            }
        }
        return treatments;
    }
    const statements = buildStatementTotals(cardTransactions);
    for (const transaction of bankTransactions) {
        const id = getTransactionId(transaction);
        if (!id)
            continue;
        const textSource = (0, exports.getSettlementTextSource)(transaction);
        const textTreatment = (0, exports.classifySettlement)(textSource, true);
        if (textTreatment === 'exclude') {
            treatments.set(id, textTreatment);
            continue;
        }
        if (findStrongContextualMatch(transaction, statements)) {
            treatments.set(id, 'exclude');
        }
    }
    return treatments;
};
exports.buildSettlementTreatmentMap = buildSettlementTreatmentMap;
