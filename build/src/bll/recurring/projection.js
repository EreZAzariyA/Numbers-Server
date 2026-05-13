"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectMonth = void 0;
const frequency_detection_1 = require("./frequency-detection");
/**
 * Generate projected events for a given date window from stored patterns.
 *
 * Classification-specific rules:
 *  - `one_time` or confidence < 0.4 → never project.
 *  - `installment_plan` → project only remaining installments.
 *  - All others → project based on frequency within the window.
 */
const projectMonth = (patterns, monthStart, monthEnd) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const events = [];
    for (const p of patterns) {
        if ((_a = p.userOverride) === null || _a === void 0 ? void 0 : _a.disabled)
            continue;
        if (p.classification === 'one_time')
            continue;
        if (p.confidence < 0.4)
            continue;
        const freq = ((_c = (_b = p.userOverride) === null || _b === void 0 ? void 0 : _b.customFrequency) !== null && _c !== void 0 ? _c : p.frequency);
        if (freq === 'unknown')
            continue;
        const effectiveAmount = (_e = (_d = p.userOverride) === null || _d === void 0 ? void 0 : _d.customAmount) !== null && _e !== void 0 ? _e : p.amount.mean;
        const effectiveClass = ((_g = (_f = p.userOverride) === null || _f === void 0 ? void 0 : _f.customClassification) !== null && _g !== void 0 ? _g : p.classification);
        const anchor = p.anchor;
        // Installment plan: cap at remaining payments.
        let maxOccurrences = Infinity;
        if (p.installmentPlan && p.installmentPlan.paymentsRemaining > 0) {
            maxOccurrences = p.installmentPlan.paymentsRemaining;
        }
        // Walk forward from lastSeen, emitting events that fall in [monthStart, monthEnd].
        let cursor = p.observed.lastSeen;
        let emitted = 0;
        const safeLimit = 60; // guard against infinite loop
        let iterations = 0;
        while (iterations++ < safeLimit && emitted < maxOccurrences) {
            const next = (0, frequency_detection_1.nextOccurrence)(cursor, freq, anchor);
            if (next > monthEnd)
                break;
            cursor = next;
            if (next < monthStart)
                continue;
            events.push({
                description: (_h = p.signals.descriptionVariants[0]) !== null && _h !== void 0 ? _h : p.merchantKey,
                amount: Math.round(effectiveAmount * 100) / 100,
                expectedDate: next,
                type: p.kind,
                alreadyReceived: false,
                status: 'pending',
                confidence: p.confidence,
                merchantKey: p.merchantKey,
                classification: effectiveClass,
                patternId: (_j = p._id) === null || _j === void 0 ? void 0 : _j.toString(),
                source: p.source,
            });
            emitted++;
        }
    }
    events.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    return events;
};
exports.projectMonth = projectMonth;
