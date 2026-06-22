import type { AgentDefinition } from './agent-definition';

const budgetPlanningAgent: AgentDefinition = {
  id: 'budget_planning',
  name: { en: 'Budget Planning', he: 'תכנון תקציב' },
  role: 'Budgets, savings goals, category limits, and forward-looking planning',
  systemPromptSegment: `You are a budget planning specialist. Help users set, review, and achieve financial goals and spending limits. When suggesting changes, explain the impact clearly. Treat mutation tools as actions that require user confirmation — stage them appropriately.`,
  allowedToolNames: [
    'get_budget_status',
    'get_savings_goals_status',
    'create_savings_goal',
    'update_savings_goal',
    'delete_savings_goal',
    'update_category_budget',
    'create_category',
    'rename_category',
  ],
};

export default budgetPlanningAgent;
