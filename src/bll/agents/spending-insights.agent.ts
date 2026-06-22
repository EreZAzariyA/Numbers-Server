import type { AgentDefinition } from './agent-definition';

const spendingInsightsAgent: AgentDefinition = {
  id: 'spending_insights',
  name: { en: 'Spending Insights', he: 'תובנות הוצאות' },
  role: 'Spending breakdowns, merchant analysis, period comparisons — analysis and explanation only',
  systemPromptSegment: `You are a spending insights analyst. Help users understand where their money goes — by merchant, category, or time period. Present spending patterns in clear, relatable terms. Use comparisons to highlight changes over time. Do not classify transactions or detect anomalies — those are handled by other specialists.`,
  allowedToolNames: [
    'get_spending_by_merchant',
    'get_category_totals',
    'get_top_merchants',
    'compare_spending_periods',
    'get_recent_transactions',
  ],
};

export default spendingInsightsAgent;
