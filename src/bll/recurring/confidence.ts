import { signalCorroborationRatio } from './merchant-key';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Weighted 0..1 confidence score for a recurring pattern.
 *
 * Weights:
 *   25%  occurrence depth       (more months = more confident)
 *   20%  frequency stability    (low CV on gaps)
 *   20%  amount stability       (low CV on amounts)
 *   15%  signal corroboration   (multiple fields agree)
 *   10%  recent regularity      (inverse missed cycles)
 *   10%  user confirmation      (boolean boost)
 */
export const computeConfidence = (p: {
  occurrences: number;
  stability: number;
  amountMean: number;
  amountStddev: number;
  signals: {
    companyIds?: string[];
    categoryIds?: string[];
    channels?: string[];
    descriptionVariants?: string[];
    memoVariants?: string[];
  };
  missedInLast6Cycles: number;
  userConfirmed: boolean;
}): number => {
  const occDepth = Math.min(1, p.occurrences / 6);
  const freqStab = p.stability;
  const amtStab = clamp01(1 - (p.amountStddev / Math.max(p.amountMean, 1)));
  const sigCorr = signalCorroborationRatio(p.signals);
  const regularity = 1 - p.missedInLast6Cycles / 6;
  const confirmed = p.userConfirmed ? 1 : 0;

  return clamp01(
    0.25 * occDepth +
    0.20 * freqStab +
    0.20 * amtStab +
    0.15 * sigCorr +
    0.10 * regularity +
    0.10 * confirmed
  );
};
