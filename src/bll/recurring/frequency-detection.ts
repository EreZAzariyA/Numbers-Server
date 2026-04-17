import { Frequency, AnchorKind, PatternAnchor } from '../../utils/types';
import { diffDays, dayOfMonth, dayOfWeek, addDays, ymd, yearOf, monthOf, clampDayOfMonth, daysInMonth } from '../../utils/date-helpers';

export interface FrequencyResult {
  freq: Frequency;
  anchor: PatternAnchor;
  stability: number; // 0..1
}

// Window ranges (days) for each frequency bucket.
const WINDOWS: Record<string, [number, number]> = {
  weekly:     [5, 9],
  biweekly:   [12, 16],
  monthly:    [27, 33],
  bimonthly:  [55, 65],
  quarterly:  [85, 95],
  semiannual: [175, 190],
  annual:     [355, 375],
};

const PERIOD_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  bimonthly: 60,
  quarterly: 91,
  semiannual: 182,
  annual: 365,
};

const stddev = (vals: number[]): number => {
  if (vals.length < 2) return 0;
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length);
};

const mode = (vals: number[]): number => {
  const hist: Record<number, number> = {};
  for (const v of vals) hist[v] = (hist[v] ?? 0) + 1;
  return +Object.entries(hist).sort(([, a], [, b]) => b - a)[0][0];
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Histogram-windowed frequency classifier with DOM/DOW/businessDay anchor.
 */
export const detectFrequency = (dates: string[]): FrequencyResult => {
  const unknownResult: FrequencyResult = {
    freq: 'unknown',
    anchor: { kind: 'dayOfMonth', value: 1, stddevDays: 0 },
    stability: 0,
  };

  if (dates.length < 3) return unknownResult;

  const sorted = [...dates].sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = diffDays(sorted[i - 1], sorted[i]);
    if (g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return unknownResult;

  // Find the window that captures the majority of gaps.
  let winnerName: string | null = null;
  let winnerHitRatio = 0;
  let winnerGaps: number[] = [];

  for (const [name, [lo, hi]] of Object.entries(WINDOWS)) {
    const hits = gaps.filter((g) => g >= lo && g <= hi);
    const ratio = hits.length / gaps.length;
    if (ratio > winnerHitRatio) {
      winnerName = name;
      winnerHitRatio = ratio;
      winnerGaps = hits;
    }
  }

  if (!winnerName || winnerHitRatio < 0.6) return unknownResult;

  const mean = winnerGaps.reduce((s, g) => s + g, 0) / winnerGaps.length;
  const cv = mean > 0 ? stddev(winnerGaps) / mean : 1;
  const stability = clamp01(1 - cv);

  // --- Anchor detection ---
  let anchor: PatternAnchor;

  const doms = sorted.map((d) => dayOfMonth(d));
  const domHist: Record<number, number> = {};
  for (const d of doms) domHist[d] = (domHist[d] ?? 0) + 1;
  const topDom = +Object.entries(domHist).sort(([, a], [, b]) => b - a)[0][0];
  const domConcentration = (domHist[topDom] ?? 0) / doms.length;

  if (domConcentration >= 0.7) {
    anchor = {
      kind: 'dayOfMonth',
      value: topDom,
      stddevDays: Math.round(stddev(doms) * 10) / 10,
    };
  } else {
    const dows = sorted.map((d) => dayOfWeek(d));
    const dowHist: Record<number, number> = {};
    for (const d of dows) dowHist[d] = (dowHist[d] ?? 0) + 1;
    const topDow = +Object.entries(dowHist).sort(([, a], [, b]) => b - a)[0][0];
    const dowConcentration = (dowHist[topDow] ?? 0) / dows.length;

    if (dowConcentration >= 0.7) {
      anchor = {
        kind: 'dayOfWeek',
        value: topDow,
        stddevDays: Math.round(stddev(dows) * 10) / 10,
      };
    } else {
      // Fallback: use mode DOM with wider stddev.
      anchor = {
        kind: 'dayOfMonth',
        value: mode(doms),
        stddevDays: Math.round(stddev(doms) * 10) / 10,
      };
    }
  }

  return {
    freq: winnerName as Frequency,
    anchor,
    stability,
  };
};

/**
 * Compute the next occurrence after `lastDate` given frequency and anchor.
 * Snaps to the anchor (e.g. day-of-month) in the next cycle.
 */
export const nextOccurrence = (lastDate: string, freq: Frequency, anchor: PatternAnchor): string => {
  if (freq === 'unknown') return addDays(lastDate, 30); // fallback

  const periodDays = PERIOD_DAYS[freq] ?? 30;

  if (anchor.kind === 'dayOfMonth' && periodDays >= 27) {
    // Monthly or longer — snap to anchor DOM in the next cycle.
    const y = yearOf(lastDate);
    const m = monthOf(lastDate);
    const cycleMonths = Math.max(1, Math.round(periodDays / 30));
    let nextM = m + cycleMonths;
    let nextY = y;
    while (nextM > 11) { nextM -= 12; nextY++; }
    return ymd(nextY, nextM, anchor.value);
  }

  if (anchor.kind === 'dayOfWeek' && periodDays <= 14) {
    // Weekly/biweekly — snap to anchor DOW.
    const base = addDays(lastDate, periodDays);
    const baseDow = dayOfWeek(base);
    let delta = (anchor.value - baseDow + 7) % 7;
    // If delta would push us more than half the period away, subtract a week.
    if (delta > Math.floor(periodDays / 2)) delta -= 7;
    return addDays(base, delta);
  }

  // Generic fallback.
  return addDays(lastDate, periodDays);
};
