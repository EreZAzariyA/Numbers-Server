export type AgentId =
  | 'financial_analyst'
  | 'budget_planning'
  | 'cash_flow'
  | 'spending_insights'
  | 'categorization'
  | 'risk_anomaly'
  | 'reporting'
  | 'user_chat';

export interface AgentDefinition {
  id: AgentId;
  name: { en: string; he: string };
  role: string;
  systemPromptSegment: string;
  allowedToolNames: string[];
}

export interface ClassificationResult {
  agentIds: AgentId[];
  confidence: number;
  reasoning: string;
}
