/**
 * Deterministic 1-D amount clustering with FX-aware path.
 *
 * Uses originalAmount + originalCurrency when available (avoids FX rate noise);
 * otherwise uses chargedAmount / amount in ILS.
 *
 * Split threshold adapts: max(3% of seed, 2 × runningStddev).
 * Produces order-independent results (sorted input).
 */

export interface AmountCluster {
  currency: string;
  isFx: boolean;
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  txIndices: number[];
}

type TxAmountEntry = {
  index: number;
  amount: number;
  currency: string;
  isFx: boolean;
};

const stddev = (vals: number[]): number => {
  if (vals.length < 2) return 0;
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length);
};

const median = (vals: number[]): number => {
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const extractAmount = (tx: any): TxAmountEntry | null => {
  const index = tx._index ?? 0;
  // Prefer original currency when it's not ILS (foreign purchase).
  if (tx.originalCurrency && tx.originalCurrency !== 'ILS' && typeof tx.originalAmount === 'number') {
    return {
      index,
      amount: Math.abs(tx.originalAmount),
      currency: tx.originalCurrency,
      isFx: true,
    };
  }
  const amt = tx.chargedAmount ?? tx.amount ?? 0;
  return {
    index,
    amount: Math.abs(amt),
    currency: 'ILS',
    isFx: false,
  };
};

export const clusterAmounts = (txs: any[]): AmountCluster[] => {
  // Tag each tx with its index for traceability.
  const entries: TxAmountEntry[] = txs.map((tx, i) => {
    const e = extractAmount({ ...tx, _index: i });
    return e!;
  }).filter((e) => e.amount > 0);

  // Group by currency first.
  const byCurrency = new Map<string, TxAmountEntry[]>();
  for (const e of entries) {
    if (!byCurrency.has(e.currency)) byCurrency.set(e.currency, []);
    byCurrency.get(e.currency)!.push(e);
  }

  const clusters: AmountCluster[] = [];

  for (const [currency, currEntries] of byCurrency) {
    const sorted = [...currEntries].sort((a, b) => a.amount - b.amount);
    const allVals = sorted.map((e) => e.amount);
    const globalStddev = stddev(allVals);

    // Seed clusters: split where gap exceeds adaptive threshold.
    const seeds: TxAmountEntry[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const last = seeds[seeds.length - 1];
      const lastMean = last.reduce((s, e) => s + e.amount, 0) / last.length;
      const threshold = Math.max(0.03 * lastMean, 2 * globalStddev, 1);
      if (Math.abs(sorted[i].amount - lastMean) > threshold) {
        seeds.push([sorted[i]]);
      } else {
        last.push(sorted[i]);
      }
    }

    // Assign each entry to its cluster.
    for (const seed of seeds) {
      const vals = seed.map((e) => e.amount);
      clusters.push({
        currency,
        isFx: seed[0].isFx,
        mean: vals.reduce((s, v) => s + v, 0) / vals.length,
        median: median(vals),
        stddev: stddev(vals),
        min: Math.min(...vals),
        max: Math.max(...vals),
        txIndices: seed.map((e) => e.index),
      });
    }
  }

  return clusters;
};
