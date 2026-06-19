import { ComponentResult, MonthlySpend } from './types';

export interface ForecastPromptInput {
  historicalMonths: MonthlySpend[];
  currentMonthSpend: number;
  forecastAmount: number;
  averageMonthlySpend: number;
  trend: 'up' | 'down' | 'flat';
  daysElapsed: number;
  totalDays: number;
  daysRemaining: number;
}

export interface FinancialHealthPromptInput {
  score: number;
  status: 'good' | 'warning' | 'bad';
  components: {
    cashFlow: ComponentResult;
    categoryBudgets: ComponentResult;
    savingsTrend: ComponentResult;
    debtPressure: ComponentResult;
  };
}

export interface SavingsGoalPromptInput {
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  monthsRemaining: number;
  remainingAmount: number;
  requiredMonthly: number;
  avgMonthlySavings: number;
  progressPct: number;
}

export interface PromptPayload {
  systemInstruction: string;
  prompt: string;
}

const asLanguageName = (language: string): 'Hebrew' | 'English' =>
  language === 'he' ? 'Hebrew' : 'English';

const asMoney = (amount: number): string => amount.toFixed(2);

const asSignedMoney = (amount: number): string => `${amount >= 0 ? '+' : '-'}${Math.abs(amount).toFixed(2)}`;

const asPercent = (value: number): string => `${value.toFixed(1)}%`;

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const componentLabels: Record<keyof FinancialHealthPromptInput['components'], string> = {
  cashFlow: 'Cash flow',
  categoryBudgets: 'Category budgets',
  savingsTrend: 'Savings trend',
  debtPressure: 'Debt pressure',
};

export const buildForecastPrompt = (
  input: ForecastPromptInput,
  language: string,
): PromptPayload => {
  const delta = input.forecastAmount - input.averageMonthlySpend;
  const deltaPct = input.averageMonthlySpend > 0
    ? (delta / input.averageMonthlySpend) * 100
    : 0;
  const historicalSummary = input.historicalMonths.length > 0
    ? input.historicalMonths
      .map((month) => `${month.month}=₪${asMoney(month.amount)}`)
      .join(' | ')
    : 'No complete historical months available';

  return {
    systemInstruction: `You are a personal finance assistant. Respond in ${asLanguageName(language)}. Produce exactly 2 complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must state whether projected spending is above, below, or roughly in line with the baseline and what that means for this month's budget. Sentence 2 must give one specific action the user can take before month end. Base every claim only on the provided data. Do not invent causes, categories, or missing context. Mention at most 2 numbers in the answer and avoid repeating the same number twice. Do not start the answer with a currency symbol or an isolated number. End both sentences normally.`,
    prompt: `Forecast summary
Period context:
- Days elapsed: ${input.daysElapsed}
- Total days in month: ${input.totalDays}
- Days remaining: ${input.daysRemaining}

Baseline:
- Complete historical months analyzed: ${input.historicalMonths.length}
- Historical monthly spend: ${historicalSummary}
- Average monthly spend baseline: ₪${asMoney(input.averageMonthlySpend)}

Current month:
- Spend so far: ₪${asMoney(input.currentMonthSpend)}
- Projected end-of-month spend: ₪${asMoney(input.forecastAmount)}
- Difference vs baseline: ${asSignedMoney(delta)} (${asPercent(Math.abs(deltaPct))} ${delta >= 0 ? 'above' : 'below'})
- Trend classification: ${titleCase(input.trend)}

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: state whether projected spending is above, below, or near the baseline and what that implies for the budget.
- Sentence 2: give one concrete action for the rest of this month.

Rules:
- Use only the data above.
- Focus on the projected end-of-month outcome, not the raw daily average.
- Do not speculate about categories or reasons that are not stated.
- Do not start the answer with a number or currency symbol.
- Keep the tone concise, practical, and specific.`,
  };
};

export const buildFinancialHealthPrompt = (
  input: FinancialHealthPromptInput,
  language: string,
): PromptPayload => {
  const componentEntries = Object.entries(input.components).map(([key, component]) => ({
    key: key as keyof FinancialHealthPromptInput['components'],
    label: componentLabels[key as keyof FinancialHealthPromptInput['components']],
    ...component,
  }));

  const sortedByScore = [...componentEntries].sort((a, b) => a.score - b.score);
  const weakest = sortedByScore[0];
  const secondary = sortedByScore[1];
  const riskSignals = sortedByScore
    .filter((entry) => entry.score <= 40)
    .slice(0, 2)
    .map((entry) => entry.label)
    .join(', ') || `${weakest.label}${secondary ? `, ${secondary.label}` : ''}`;

  return {
    systemInstruction: `You are a personal finance assistant. Respond in ${asLanguageName(language)}. Produce exactly 2 complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must identify the main driver of the score and what it means for the user's financial position. Sentence 2 must give one specific next action that targets the biggest risk. Use only the provided data. Do not summarize every component, do not invent causes, and mention no more than 3 numbers in the answer. Do not start the answer with a number or a score. End both sentences normally.`,
    prompt: `Financial health summary
Overall:
- Score: ${input.score}/100
- Status: ${titleCase(input.status)}

Components:
- Cash flow: ${input.components.cashFlow.detail} (score ${input.components.cashFlow.score}/100, status ${input.components.cashFlow.status})
- Category budgets: ${input.components.categoryBudgets.detail} (score ${input.components.categoryBudgets.score}/100, status ${input.components.categoryBudgets.status})
- Savings trend: ${input.components.savingsTrend.detail} (score ${input.components.savingsTrend.score}/100, status ${input.components.savingsTrend.status})
- Debt pressure: ${input.components.debtPressure.detail} (score ${input.components.debtPressure.score}/100, status ${input.components.debtPressure.status})

Priority signals:
- Weakest component: ${weakest.label} (${weakest.score}/100)
- Main risk signals: ${riskSignals}

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: explain the main reason the overall score is ${input.status} and what that means.
- Sentence 2: give one concrete action that addresses the biggest risk first.

Rules:
- Use only the data above.
- Focus on the most important negative or limiting signal, not every component.
- Do not repeat the full score breakdown in the answer.
- Do not start the answer with a number, score, or percentage.
- Keep the advice practical and specific.`,
  };
};

export const buildSavingsGoalPrompt = (
  input: SavingsGoalPromptInput,
  language: string,
): PromptPayload => {
  const paceGap = input.avgMonthlySavings - input.requiredMonthly;
  const paceStatus = paceGap >= 0
    ? 'On track'
    : paceGap >= -(input.requiredMonthly * 0.15)
      ? 'Slightly behind'
      : 'Far behind';

  return {
    systemInstruction: `You are a personal finance assistant. Respond in ${asLanguageName(language)}. Produce exactly 2 short complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must say whether the user is on track, slightly behind, or far behind based on the savings pace. Sentence 2 must give one specific action to close the gap. Use only the data provided. Do not invent income sources, expense categories, or personal circumstances. Mention no more than 3 numbers in the answer. Do not start the answer with a number, percentage, or currency symbol. End both sentences normally.`,
    prompt: `Savings goal summary
- Goal: "${input.name}"
- Target amount: ₪${asMoney(input.targetAmount)}
- Current saved: ₪${asMoney(input.currentAmount)}
- Progress: ${input.progressPct}%
- Deadline: ${input.targetDate}
- Months remaining: ${input.monthsRemaining}
- Amount remaining: ₪${asMoney(input.remainingAmount)}
- Required monthly savings: ₪${asMoney(input.requiredMonthly)}
- Average monthly net savings: ₪${asMoney(input.avgMonthlySavings)}
- Monthly pace gap vs target: ${asSignedMoney(paceGap)}
- Pace status: ${paceStatus}

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: say whether the user is on track, slightly behind, or far behind using the pace gap.
- Sentence 2: give one concrete action that would help close the gap.

Rules:
- Use only the data above.
- Be specific and practical, not generic.
- Do not restate every number from the prompt.
- Do not start the answer with a number, percentage, or currency symbol.
- Do not give encouragement that is not supported by the data.`,
  };
};
