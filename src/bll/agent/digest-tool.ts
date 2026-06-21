import agentInsightsLogic from '../agent-insights';
import type { AgentToolDefinition, ToolHost } from './tool-types';

export const createDigestTool = (_host: ToolHost): AgentToolDefinition[] => [
  {
    name: 'get_financial_digest',
    description: `Get the latest AI-generated financial digest. Returns a narrative summary and structured findings from background analysis covering daily expenses, anomalies, subscription signals, budget risks, and income changes.
Call this for general check-in questions ("how am I doing?", "anything I should know?", "what changed recently?") or to get background context when discussing spending, budgets, or income.`,
    mode: 'read',
    schema: { type: 'object', properties: {} },
    summarize: () => 'Review the financial digest.',
    execute: async (_, context) => agentInsightsLogic.getLatestDigest(context.user_id),
  },
];
