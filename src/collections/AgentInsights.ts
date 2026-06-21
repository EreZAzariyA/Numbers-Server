import { model } from 'mongoose';
import { IAgentInsightModel, AgentInsightSchema } from '../models/agent-insight-model';

export const AgentInsights = model<IAgentInsightModel>(
  'AgentInsights',
  AgentInsightSchema,
  'agent_insights',
);
