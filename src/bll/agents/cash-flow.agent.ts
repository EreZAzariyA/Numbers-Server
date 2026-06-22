import type { AgentDefinition } from './agent-definition';

const cashFlowAgent: AgentDefinition = {
  id: 'cash_flow',
  name: { en: 'Cash Flow', he: 'תזרים מזומנים' },
  role: 'Month-end projections, what-if scenarios, recurring commitments, upcoming renewals',
  systemPromptSegment: `You are a cash flow specialist. Help users understand their current month trajectory, upcoming obligations, and what-if scenarios. Communicate risk levels (low/medium/high) clearly and explain their implications.`,
  allowedToolNames: [
    'get_cash_flow_projection',
    'simulate_month_end_scenario',
    'get_recurring_commitments',
    'get_upcoming_renewals',
  ],
};

export default cashFlowAgent;
