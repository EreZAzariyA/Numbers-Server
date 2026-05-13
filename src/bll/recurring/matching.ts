import { diffDays } from '../../utils/date-helpers';
import { ProjectedEvent } from '../../utils/types';

/**
 * Actual transaction as seen in the current month.
 */
export interface ActualEvent {
  amount: number;
  absAmount: number;
  kind: 'income' | 'expense';
  merchantKey?: string;
  effectiveDate: string;
}

export interface Assignment {
  matched: Array<[number, number]>; // [eventIdx, actualIdx]
  unmatchedEvents: number[];
  unmatchedActuals: number[];
}

/**
 * Bipartite min-cost matching between projected events and actuals.
 *
 * Cost = date_z + amount_z (z-scores normalised by stddev / tolerance).
 * Pairs with cost > threshold (z > 3 on either axis) are excluded.
 *
 * For small N (<= 10): brute-force minimisation.
 * For larger N: Hungarian algorithm (pure TS, no dependency).
 */
export const matchEvents = (
  events: ProjectedEvent[],
  actuals: ActualEvent[],
  anchorStddevMap?: Map<string, number>,
  amountStddevMap?: Map<string, number>,
): Assignment => {
  const n = events.length;
  const m = actuals.length;

  if (n === 0 || m === 0) {
    return {
      matched: [],
      unmatchedEvents: Array.from({ length: n }, (_, i) => i),
      unmatchedActuals: Array.from({ length: m }, (_, i) => i),
    };
  }

  // Build cost matrix.
  const INF = 1e9;
  const cost: number[][] = [];

  for (let i = 0; i < n; i++) {
    cost[i] = [];
    const e = events[i];
    const dateStddev = anchorStddevMap?.get(e.merchantKey ?? '') ?? 3;
    const dateSigma = Math.max(2, dateStddev);
    const amtStddev = amountStddevMap?.get(e.merchantKey ?? '') ?? 0;
    const amtSigma = Math.max(0.02 * Math.abs(e.amount), amtStddev, 1);

    for (let j = 0; j < m; j++) {
      const a = actuals[j];

      // Hard filters: must agree on merchantKey (if available) and kind.
      if (e.merchantKey && a.merchantKey && e.merchantKey !== a.merchantKey) {
        cost[i][j] = INF;
        continue;
      }
      if (e.type !== a.kind) {
        cost[i][j] = INF;
        continue;
      }

      const dateZ = Math.abs(diffDays(a.effectiveDate, e.expectedDate)) / dateSigma;
      const amountZ = Math.abs(a.absAmount - Math.abs(e.amount)) / amtSigma;

      if (dateZ > 3 || amountZ > 3) {
        cost[i][j] = INF;
        continue;
      }

      cost[i][j] = dateZ + amountZ;
    }
  }

  const size = Math.max(n, m);
  let assignment: number[]; // assignment[i] = j for event i → actual j

  if (size <= 10) {
    assignment = bruteForceBipartite(cost, n, m);
  } else {
    assignment = hungarian(cost, n, m);
  }

  const matched: [number, number][] = [];
  const matchedActuals = new Set<number>();
  const matchedEvents = new Set<number>();

  for (let i = 0; i < n; i++) {
    const j = assignment[i];
    if (j !== undefined && j < m && cost[i][j] < INF) {
      matched.push([i, j]);
      matchedEvents.add(i);
      matchedActuals.add(j);
    }
  }

  return {
    matched,
    unmatchedEvents: Array.from({ length: n }, (_, i) => i).filter((i) => !matchedEvents.has(i)),
    unmatchedActuals: Array.from({ length: m }, (_, i) => i).filter((i) => !matchedActuals.has(i)),
  };
};

// --- Brute-force for small N ---

function bruteForceBipartite(cost: number[][], n: number, m: number): number[] {
  const assign = new Array<number>(n).fill(-1);
  let bestCost = Infinity;
  const bestAssign = new Array<number>(n).fill(-1);

  const used = new Set<number>();

  const dfs = (row: number, currentCost: number) => {
    if (row === n) {
      if (currentCost < bestCost) {
        bestCost = currentCost;
        for (let i = 0; i < n; i++) bestAssign[i] = assign[i];
      }
      return;
    }

    // Option: leave this event unmatched (cost 0 for skipping).
    assign[row] = -1;
    dfs(row + 1, currentCost);

    // Try matching to each available actual.
    for (let j = 0; j < m; j++) {
      if (used.has(j) || cost[row][j] >= 1e9) continue;
      const newCost = currentCost + cost[row][j];
      if (newCost >= bestCost) continue; // prune
      assign[row] = j;
      used.add(j);
      dfs(row + 1, newCost);
      used.delete(j);
    }
    assign[row] = -1;
  };

  dfs(0, 0);
  return bestAssign;
}

// --- Hungarian algorithm for larger N ---

function hungarian(cost: number[][], n: number, m: number): number[] {
  const size = Math.max(n, m);
  const INF = 1e9;

  // Pad to square matrix.
  const c: number[][] = [];
  for (let i = 0; i < size; i++) {
    c[i] = [];
    for (let j = 0; j < size; j++) {
      c[i][j] = (i < n && j < m) ? cost[i][j] : 0;
    }
  }

  const u = new Array(size + 1).fill(0);
  const v = new Array(size + 1).fill(0);
  const p = new Array(size + 1).fill(0);
  const way = new Array(size + 1).fill(0);

  for (let i = 1; i <= size; i++) {
    const minv = new Array(size + 1).fill(INF);
    const used = new Array(size + 1).fill(false);
    p[0] = i;
    let j0 = 0;

    do {
      used[j0] = true;
      let i0 = p[j0];
      let delta = INF;
      let j1 = -1;

      for (let j = 1; j <= size; j++) {
        if (used[j]) continue;
        const cur = c[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  // Build result: assignment[i] = j.
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= size; j++) {
    if (p[j] > 0 && p[j] <= n) {
      result[p[j] - 1] = j - 1;
    }
  }

  return result;
}
