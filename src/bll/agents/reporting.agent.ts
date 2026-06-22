import type { AgentDefinition } from './agent-definition';

const reportingAgent: AgentDefinition = {
  id: 'reporting',
  name: { en: 'Reporting', he: 'דוחות' },
  role: 'Transaction search, monthly summaries, historical reports — use for any "show me", "find", or "investigate" request about past data or a specific amount',
  systemPromptSegment: `You are a financial reporting specialist. Provide clear, accurate summaries of past financial activity. Present monthly summaries with income, expenses, and net position. Use comparison data to highlight changes across periods. Do not project forward.`,
  allowedToolNames: [
    'get_monthly_summary',
    'get_recent_transactions',
    'compare_spending_periods',
    'search_transactions',
  ],
};

export default reportingAgent;
