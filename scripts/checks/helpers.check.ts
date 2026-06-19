// Runnable self-checks for the shared BLL helpers. No framework — plain asserts.
//   npm run check
import assert from 'node:assert/strict';
import { round2, sumIncomeExpense } from '../../src/utils/money';
import { monthBounds, daysInMonth } from '../../src/utils/date-helpers';

// round2 must match the old inline Math.round(x * 100) / 100 exactly.
assert.equal(round2(7057.514), 7057.51);
assert.equal(round2(1.005), Math.round(1.005 * 100) / 100);
assert.equal(round2(-3.456), -3.46);
assert.equal(round2(0), 0);

// sumIncomeExpense: income (>0), expenses (abs of <0), net.
assert.deepEqual(sumIncomeExpense([100, -30, -20, 0]), { income: 100, expenses: 50, net: 50 });
assert.deepEqual(sumIncomeExpense([]), { income: 0, expenses: 0, net: 0 });

// daysInMonth (month is zero-indexed).
assert.equal(daysInMonth(2024, 1), 29); // Feb, leap year
assert.equal(daysInMonth(2025, 1), 28);
assert.equal(daysInMonth(2025, 3), 30); // April

// monthBounds: noon-UTC mid-month is timezone-safe.
const mb = monthBounds(new Date('2026-02-15T12:00:00Z'));
assert.equal(mb.monthStr, '2026-02');
assert.equal(mb.start, '2026-02-01');
assert.equal(mb.end, '2026-02-28');

console.log('helpers.check.ts: all checks passed');
