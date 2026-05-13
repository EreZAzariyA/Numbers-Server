import { normalize, stripTrailingDigits } from './normalization';
import { getCardLast4, getCounterparty, getMerchantId, getMcc, getProviderCategoryName } from '../../utils/transaction-semantics';

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
export const buildMerchantKey = (tx: any): string => {
  const merchantId = getMerchantId(tx);
  const mcc = getMcc(tx);
  const counterparty = getCounterparty(tx);
  const cardLast4 = getCardLast4(tx);
  const descriptionFallback = tx.description || counterparty || getProviderCategoryName(tx) || '';
  const normalizedDescriptionKey = stripTrailingDigits(normalize(descriptionFallback));

  if (merchantId) {
    return `mid:${merchantId}`;
  }
  if (mcc && tx.companyId) {
    return `mcc:${tx.companyId}:${mcc}:${normalize(tx.description)}`;
  }
  if (cardLast4 && normalizedDescriptionKey) {
    return `card:${cardLast4}:${normalizedDescriptionKey}`;
  }
  if (tx.companyId && counterparty) {
    return `cp:${tx.companyId}:${normalize(counterparty)}`;
  }
  if (tx.companyId && normalizedDescriptionKey) {
    return `cd:${tx.companyId}:${normalizedDescriptionKey}`;
  }
  return `desc:${normalizedDescriptionKey}`;
};

/**
 * Signal corroboration: two transactions should share a pattern only if
 * at least `minSignals` of their structured signals agree.
 * This prevents e.g. two Shufersal branches from merging just because
 * they share a stripped description.
 */
const firstToken = (s: string): string | undefined => {
  const n = normalize(s);
  return n ? n.split(' ')[0] : undefined;
};

export const agreesOn = (a: any, b: any, minSignals = 2): boolean => {
  let count = 0;
  if (a.companyId && a.companyId === b.companyId) count++;
  if (a.category_id && a.category_id.toString() === b.category_id?.toString()) count++;
  if (getCounterparty(a) && getCounterparty(a) === getCounterparty(b)) count++;
  if (getMcc(a) && getMcc(a) === getMcc(b)) count++;
  if (getMerchantId(a) && getMerchantId(a) === getMerchantId(b)) count++;
  const aFirst = firstToken(a.description ?? '');
  const bFirst = firstToken(b.description ?? '');
  if (aFirst && aFirst === bFirst) count++;
  return count >= minSignals;
};

/**
 * Count how many of the signal fields are non-empty and consistent across
 * a set of transactions. Returns a ratio 0..1 used in confidence scoring.
 */
export const signalCorroborationRatio = (signals: {
  companyIds?: string[];
  categoryIds?: string[];
  channels?: string[];
  descriptionVariants?: string[];
  memoVariants?: string[];
}): number => {
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
    if (!arr || arr.length === 0) continue;
    populated++;
    const unique = new Set(arr);
    if (unique.size === 1) consistent++;
  }
  return populated === 0 ? 0 : consistent / populated;
};
