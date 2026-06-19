import { classifySettlement, SettlementTreatment } from '../../utils/settlement-detection';

export type SettlementDataQuality = {
  lowConfidenceSettlementCount: number;
  lowConfidenceSettlementSpend: number;
};

export type SettlementAccessors<T> = {
  id: (t: T) => string;
  text: (t: T) => string;
  amount: (t: T) => number;
};

// Drop credit-card settlement rows ('exclude') and tally low-confidence expense
// settlements into `dataQuality`. Returns the kept transactions for the caller
// to map. Mirrors the inline settlement blocks in forecast/financial-health.
export const filterAndTallySettlements = <T>(
  txns: T[],
  treatments: Map<string, SettlementTreatment>,
  hasCardData: boolean,
  accessors: SettlementAccessors<T>,
  dataQuality: SettlementDataQuality,
): T[] =>
  txns.filter((t) => {
    const treatment = treatments.get(accessors.id(t)) ?? classifySettlement(accessors.text(t), hasCardData);
    if (treatment === 'exclude') return false;
    if (treatment === 'low-confidence' && accessors.amount(t) < 0) {
      dataQuality.lowConfidenceSettlementCount += 1;
      dataQuality.lowConfidenceSettlementSpend += Math.abs(accessors.amount(t));
    }
    return true;
  });
