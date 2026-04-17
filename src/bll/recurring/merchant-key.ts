import { normalize, stripTrailingDigits } from './normalization';

/**
 * Build a deterministic composite key that groups transactions from the same
 * "logical merchant" while keeping structurally-different entities separate
 * (e.g. Shufersal branch 124 vs 507).
 *
 * Hierarchy:
 *  1. merchantId from raw (most reliable)
 *  2. mcc + companyId + normalized description
 *  3. companyId + memo
 *  4. companyId + category_id
 *  5. normalized description with trailing digits stripped (fallback)
 */
export const buildMerchantKey = (tx: any): string => {
  if (tx.rawTransaction?.merchantId) {
    return `mid:${tx.rawTransaction.merchantId}`;
  }
  if (tx.rawTransaction?.mcc && tx.companyId) {
    return `mcc:${tx.companyId}:${tx.rawTransaction.mcc}:${normalize(tx.description)}`;
  }
  if (tx.companyId && tx.memo) {
    return `cm:${tx.companyId}:${normalize(tx.memo)}`;
  }
  if (tx.companyId && tx.category_id) {
    return `cc:${tx.companyId}:${tx.category_id}`;
  }
  return `desc:${stripTrailingDigits(normalize(tx.description || tx.memo || tx.categoryDescription || tx.channelName || ''))}`;
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
  if (a.channel && a.channel === b.channel) count++;
  if (a.channelName && a.channelName === b.channelName) count++;
  if (a.rawTransaction?.mcc && a.rawTransaction.mcc === b.rawTransaction?.mcc) count++;
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
