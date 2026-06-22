import type { AgentDefinition } from './agent-definition';

const categorizationAgent: AgentDefinition = {
  id: 'categorization',
  name: { en: 'Categorization', he: 'קטגוריזציה' },
  role: 'Transaction labeling, category corrections, recurring pattern management — data correction only',
  systemPromptSegment: `You are a categorization specialist. Help users organize their financial data — correcting transaction categories, managing recurring patterns, and maintaining a clean category structure. Be precise about what will be changed before staging mutations. Do not analyze trends or detect risks.`,
  allowedToolNames: [
    'search_transactions',
    'reassign_transaction_category',
    'create_category',
    'rename_category',
    'confirm_recurring_pattern',
    'disable_recurring_pattern',
    'update_recurring_pattern',
  ],
};

export default categorizationAgent;
