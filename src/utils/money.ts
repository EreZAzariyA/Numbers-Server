// Currency-amount helpers shared across the BLL.

// Round to 2 decimal places (cents). Mirrors the previous inline
// Math.round(x * 100) / 100 used throughout forecast/health/cash-flow.
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export type IncomeExpense = { income: number; expenses: number; net: number };

// Split signed amounts into income (> 0), expenses (absolute of < 0), and net.
export const sumIncomeExpense = (amounts: number[]): IncomeExpense => {
  let income = 0;
  let expenses = 0;
  for (const amount of amounts) {
    if (amount > 0) income += amount;
    else if (amount < 0) expenses += -amount;
  }
  return { income, expenses, net: income - expenses };
};
