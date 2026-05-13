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

import { normalize } from '../bll/recurring/normalization';
import { diffDays, toDateStr, ymd } from './date-helpers';
import { getPostingDate, getSemanticType, getTransactionAmount, getTransactionTextSource } from './transaction-semantics';

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
].map(normalize);

const NORMALIZED_ISSUER_KW = CARD_ISSUER_KEYWORDS.map(normalize);

const PROVIDER_ALIAS_GROUPS = [
  { issuer: 'cal', aliases: ['כאל', 'cal', 'visa cal', 'visacal', 'leumi card', 'לאומי קארד'] },
  { issuer: 'max', aliases: ['מקס', 'max', 'maxcard'] },
  { issuer: 'isracard', aliases: ['ישראכרט', 'isracard', 'behatsdaa', 'בהצדעה'] },
] as const;

const ROUNDING_TOLERANCE = 1;
const STATEMENT_MATCH_TOLERANCE = 0.08;
const STATEMENT_MATCH_TOLERANCE_WITH_HINT = 0.12;
const MIN_CONTEXTUAL_SETTLEMENT_AMOUNT = 250;
const MIN_STRONG_CONTEXTUAL_SETTLEMENT_AMOUNT = 500;
const MIN_CARD_STATEMENT_AMOUNT = 100;
const MIN_DATE_GAP_DAYS = -3;
const MAX_DATE_GAP_DAYS = 25;

type SettlementContextTransaction = {
  _id?: { toString(): string } | string;
  amount?: number;
  chargedAmount?: number;
  description?: string;
  memo?: string;
  categoryDescription?: string;
  channelName?: string;
  date?: string | Date;
  processedDate?: string | Date;
  companyId?: string;
  semanticType?: string;
};

type StatementTotal = {
  issuer: string;
  month: string;
  monthEnd: string;
  amount: number;
};

const getTransactionId = (transaction: SettlementContextTransaction): string => {
  if (!transaction?._id) return '';
  return typeof transaction._id === 'string'
    ? transaction._id
    : transaction._id.toString();
};

const getTransactionDate = (transaction: SettlementContextTransaction): string => {
  const source = getPostingDate(transaction);
  return source ? toDateStr(source) : '';
};

export const getSettlementTextSource = (transaction: SettlementContextTransaction): string =>
  getTransactionTextSource(transaction);

const getMonthEnd = (month: string): string => {
  const [year, monthPart] = month.split('-').map(Number);
  return ymd(year, monthPart - 1, 31);
};

const getIssuerFromCompanyId = (companyId?: string): string | null => {
  const norm = normalize(companyId ?? '');
  if (!norm) return null;

  for (const group of PROVIDER_ALIAS_GROUPS) {
    if (group.aliases.some((alias) => norm.includes(normalize(alias)))) {
      return group.issuer;
    }
  }

  return null;
};

const getIssuerHintFromText = (text: string): string | null => {
  const norm = normalize(text);
  if (!norm) return null;

  for (const group of PROVIDER_ALIAS_GROUPS) {
    if (group.aliases.some((alias) => norm.includes(normalize(alias)))) {
      return group.issuer;
    }
  }

  return null;
};

const isRoundedSettlementAmount = (amount: number): boolean => {
  const absoluteAmount = Math.abs(amount);
  if (absoluteAmount < MIN_CONTEXTUAL_SETTLEMENT_AMOUNT) return false;

  const nearestTen = Math.round(absoluteAmount / 10) * 10;
  const nearestFifty = Math.round(absoluteAmount / 50) * 50;
  return (
    Math.abs(absoluteAmount - nearestTen) <= ROUNDING_TOLERANCE ||
    Math.abs(absoluteAmount - nearestFifty) <= ROUNDING_TOLERANCE
  );
};

const buildStatementTotals = (
  cardTransactions: SettlementContextTransaction[],
): StatementTotal[] => {
  const totals = new Map<string, number>();

  for (const transaction of cardTransactions) {
    if (getSemanticType(transaction) === 'card_settlement') {
      continue;
    }
    const issuer = getIssuerFromCompanyId(transaction.companyId);
    if (!issuer) continue;

    const date = getTransactionDate(transaction);
    if (!date) continue;

    const amount = getTransactionAmount(transaction);
    if (amount === 0) continue;

    const month = date.slice(0, 7);
    const key = `${issuer}:${month}`;
    totals.set(key, (totals.get(key) ?? 0) + amount);
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

const findStrongContextualMatch = (
  transaction: SettlementContextTransaction,
  statements: StatementTotal[],
): boolean => {
  const amount = getTransactionAmount(transaction);
  const absoluteAmount = Math.abs(amount);
  const date = getTransactionDate(transaction);
  const textSource = getSettlementTextSource(transaction);
  const issuerHint = getIssuerHintFromText(textSource);
  const hasTextHint = isSettlementDescription(textSource);

  if (!date || absoluteAmount < MIN_CONTEXTUAL_SETTLEMENT_AMOUNT) {
    return false;
  }

  for (const statement of statements) {
    if (issuerHint && statement.issuer !== issuerHint) continue;

    const dateGap = diffDays(statement.monthEnd, date);
    if (dateGap < MIN_DATE_GAP_DAYS || dateGap > MAX_DATE_GAP_DAYS) continue;

    const amountDiffRatio = Math.abs(absoluteAmount - statement.amount) / Math.max(statement.amount, 1);
    const amountTolerance = issuerHint || hasTextHint
      ? STATEMENT_MATCH_TOLERANCE_WITH_HINT
      : STATEMENT_MATCH_TOLERANCE;

    if (amountDiffRatio > amountTolerance) continue;

    if (hasTextHint) return true;
    if (issuerHint && absoluteAmount >= MIN_CONTEXTUAL_SETTLEMENT_AMOUNT) return true;
    if (absoluteAmount >= MIN_STRONG_CONTEXTUAL_SETTLEMENT_AMOUNT) return true;
    if (isRoundedSettlementAmount(absoluteAmount)) return true;
  }

  return false;
};

/**
 * Check whether a transaction description looks like a credit-card settlement.
 */
export const isSettlementDescription = (description: string): boolean => {
  const norm = normalize(description);
  if (!norm) return false;

  // Direct match against known settlement phrases.
  if (NORMALIZED_SETTLEMENT.some((p) => norm.includes(p))) return true;

  // Heuristic: description contains a card-issuer keyword AND a payment-like
  // verb (Hebrew: "תשלום", "חיוב", "הסדר"; English: "payment", "charge").
  const paymentVerbs = ['תשלום', 'חיוב', 'הסדר', 'payment', 'charge', 'settlement'];
  const hasIssuer = NORMALIZED_ISSUER_KW.some((kw) => norm.includes(kw));
  const hasVerb = paymentVerbs.some((v) => norm.includes(v));
  if (hasIssuer && hasVerb) return true;

  return false;
};

export type SettlementTreatment = 'exclude' | 'low-confidence' | 'normal';

/**
 * Classify a transaction as settlement / normal.
 *
 * @param description  Raw transaction description.
 * @param hasCardData  Whether the user has *any* card transactions in the
 *                     relevant period.  When true, individual card charges
 *                     already cover the spending and the settlement is pure
 *                     double-counting.
 */
export const classifySettlement = (
  description: string,
  hasCardData: boolean,
): SettlementTreatment => {
  if (!isSettlementDescription(description)) return 'normal';
  return hasCardData ? 'exclude' : 'low-confidence';
};

export const buildSettlementTreatmentMap = (
  bankTransactions: SettlementContextTransaction[],
  cardTransactions: SettlementContextTransaction[],
): Map<string, SettlementTreatment> => {
  const hasCardData = cardTransactions.length > 0;
  const treatments = new Map<string, SettlementTreatment>();

  if (!hasCardData) {
    for (const transaction of bankTransactions) {
      const id = getTransactionId(transaction);
      if (!id) continue;

      const textSource = getSettlementTextSource(transaction);
      const treatment = classifySettlement(textSource, false);
      if (treatment !== 'normal') {
        treatments.set(id, treatment);
      }
    }
    return treatments;
  }

  const statements = buildStatementTotals(cardTransactions);

  for (const transaction of bankTransactions) {
    const id = getTransactionId(transaction);
    if (!id) continue;

    const textSource = getSettlementTextSource(transaction);
    const textTreatment = classifySettlement(textSource, true);
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
