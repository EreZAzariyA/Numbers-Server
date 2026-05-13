"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeConfidence = void 0;
const merchant_key_1 = require("./merchant-key");
const clamp01 = (v) => Math.min(1, Math.max(0, v));
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
const computeConfidence = (p) => {
    const occDepth = Math.min(1, p.occurrences / 6);
    const freqStab = p.stability;
    const amtStab = clamp01(1 - (p.amountStddev / Math.max(p.amountMean, 1)));
    const sigCorr = (0, merchant_key_1.signalCorroborationRatio)(p.signals);
    const regularity = 1 - p.missedInLast6Cycles / 6;
    const confirmed = p.userConfirmed ? 1 : 0;
    return clamp01(0.25 * occDepth +
        0.20 * freqStab +
        0.20 * amtStab +
        0.15 * sigCorr +
        0.10 * regularity +
        0.10 * confirmed);
};
exports.computeConfidence = computeConfidence;
