"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextUpcomingOccurrence = exports.nextOccurrence = exports.detectFrequency = exports.MIN_RECURRING_OCCURRENCES = void 0;
const date_helpers_1 = require("../../utils/date-helpers");
exports.MIN_RECURRING_OCCURRENCES = 3;
const MIN_MATCHING_GAPS = exports.MIN_RECURRING_OCCURRENCES - 1;
// Window ranges (days) for each frequency bucket.
const WINDOWS = {
    weekly: [5, 9],
    biweekly: [12, 16],
    monthly: [27, 33],
    bimonthly: [55, 65],
    quarterly: [85, 95],
    semiannual: [175, 190],
    annual: [355, 375],
};
const PERIOD_DAYS = {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    bimonthly: 60,
    quarterly: 91,
    semiannual: 182,
    annual: 365,
};
const stddev = (vals) => {
    if (vals.length < 2)
        return 0;
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    return Math.sqrt(vals.reduce((s, v) => s + Math.pow((v - m), 2), 0) / vals.length);
};
const mode = (vals) => {
    var _a;
    const hist = {};
    for (const v of vals)
        hist[v] = ((_a = hist[v]) !== null && _a !== void 0 ? _a : 0) + 1;
    return +Object.entries(hist).sort(([, a], [, b]) => b - a)[0][0];
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const longestMatchingRun = (gaps, lo, hi) => {
    let longest = 0;
    let current = 0;
    for (const gap of gaps) {
        if (gap >= lo && gap <= hi) {
            current += 1;
            longest = Math.max(longest, current);
        }
        else {
            current = 0;
        }
    }
    return longest;
};
/**
 * Histogram-windowed frequency classifier with DOM/DOW/businessDay anchor.
 */
const detectFrequency = (dates) => {
    var _a, _b, _c, _d;
    const unknownResult = {
        freq: 'unknown',
        anchor: { kind: 'dayOfMonth', value: 1, stddevDays: 0 },
        stability: 0,
    };
    if (dates.length < exports.MIN_RECURRING_OCCURRENCES)
        return unknownResult;
    const sorted = [...dates].sort();
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
        const g = (0, date_helpers_1.diffDays)(sorted[i - 1], sorted[i]);
        if (g > 0)
            gaps.push(g);
    }
    if (gaps.length === 0)
        return unknownResult;
    // Find the window that captures the majority of gaps.
    let winnerName = null;
    let winnerHitRatio = 0;
    let winnerGaps = [];
    let winnerLongestRun = 0;
    for (const [name, [lo, hi]] of Object.entries(WINDOWS)) {
        const hits = gaps.filter((g) => g >= lo && g <= hi);
        const ratio = hits.length / gaps.length;
        const longestRun = longestMatchingRun(gaps, lo, hi);
        if (ratio > winnerHitRatio || (ratio === winnerHitRatio && longestRun > winnerLongestRun)) {
            winnerName = name;
            winnerHitRatio = ratio;
            winnerGaps = hits;
            winnerLongestRun = longestRun;
        }
    }
    if (!winnerName || winnerHitRatio < 0.6 || winnerLongestRun < MIN_MATCHING_GAPS) {
        return unknownResult;
    }
    const mean = winnerGaps.reduce((s, g) => s + g, 0) / winnerGaps.length;
    const cv = mean > 0 ? stddev(winnerGaps) / mean : 1;
    const stability = clamp01(1 - cv);
    // --- Anchor detection ---
    let anchor;
    const doms = sorted.map((d) => (0, date_helpers_1.dayOfMonth)(d));
    const domHist = {};
    for (const d of doms)
        domHist[d] = ((_a = domHist[d]) !== null && _a !== void 0 ? _a : 0) + 1;
    const topDom = +Object.entries(domHist).sort(([, a], [, b]) => b - a)[0][0];
    const domConcentration = ((_b = domHist[topDom]) !== null && _b !== void 0 ? _b : 0) / doms.length;
    if (domConcentration >= 0.7) {
        anchor = {
            kind: 'dayOfMonth',
            value: topDom,
            stddevDays: Math.round(stddev(doms) * 10) / 10,
        };
    }
    else {
        const dows = sorted.map((d) => (0, date_helpers_1.dayOfWeek)(d));
        const dowHist = {};
        for (const d of dows)
            dowHist[d] = ((_c = dowHist[d]) !== null && _c !== void 0 ? _c : 0) + 1;
        const topDow = +Object.entries(dowHist).sort(([, a], [, b]) => b - a)[0][0];
        const dowConcentration = ((_d = dowHist[topDow]) !== null && _d !== void 0 ? _d : 0) / dows.length;
        if (dowConcentration >= 0.7) {
            anchor = {
                kind: 'dayOfWeek',
                value: topDow,
                stddevDays: Math.round(stddev(dows) * 10) / 10,
            };
        }
        else {
            // Fallback: use mode DOM with wider stddev.
            anchor = {
                kind: 'dayOfMonth',
                value: mode(doms),
                stddevDays: Math.round(stddev(doms) * 10) / 10,
            };
        }
    }
    return {
        freq: winnerName,
        anchor,
        stability,
    };
};
exports.detectFrequency = detectFrequency;
/**
 * Compute the next occurrence after `lastDate` given frequency and anchor.
 * Snaps to the anchor (e.g. day-of-month) in the next cycle.
 */
const nextOccurrence = (lastDate, freq, anchor) => {
    var _a;
    if (freq === 'unknown')
        return (0, date_helpers_1.addDays)(lastDate, 30); // fallback
    const periodDays = (_a = PERIOD_DAYS[freq]) !== null && _a !== void 0 ? _a : 30;
    if (anchor.kind === 'dayOfMonth' && periodDays >= 27) {
        // Monthly or longer — snap to anchor DOM in the next cycle.
        const y = (0, date_helpers_1.yearOf)(lastDate);
        const m = (0, date_helpers_1.monthOf)(lastDate);
        const cycleMonths = Math.max(1, Math.round(periodDays / 30));
        let nextM = m + cycleMonths;
        let nextY = y;
        while (nextM > 11) {
            nextM -= 12;
            nextY++;
        }
        return (0, date_helpers_1.ymd)(nextY, nextM, anchor.value);
    }
    if (anchor.kind === 'dayOfWeek' && periodDays <= 14) {
        // Weekly/biweekly — snap to anchor DOW.
        const base = (0, date_helpers_1.addDays)(lastDate, periodDays);
        const baseDow = (0, date_helpers_1.dayOfWeek)(base);
        let delta = (anchor.value - baseDow + 7) % 7;
        // If delta would push us more than half the period away, subtract a week.
        if (delta > Math.floor(periodDays / 2))
            delta -= 7;
        return (0, date_helpers_1.addDays)(base, delta);
    }
    // Generic fallback.
    return (0, date_helpers_1.addDays)(lastDate, periodDays);
};
exports.nextOccurrence = nextOccurrence;
const nextUpcomingOccurrence = (lastDate, freq, anchor, referenceDate = new Date().toISOString().slice(0, 10)) => {
    let next = (0, exports.nextOccurrence)(lastDate, freq, anchor);
    let guard = 0;
    while (next < referenceDate && guard++ < 240) {
        next = (0, exports.nextOccurrence)(next, freq, anchor);
    }
    return next;
};
exports.nextUpcomingOccurrence = nextUpcomingOccurrence;
