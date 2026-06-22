import type { AgentDefinition } from './agent-definition';

const riskAnomalyAgent: AgentDefinition = {
  id: 'risk_anomaly',
  name: { en: 'Risk & Anomaly', he: 'סיכון וחריגות' },
  role: 'Unusual activity, subscription price changes, anomaly detection — detection and alerting only',
  systemPromptSegment: `You are a risk and anomaly detection specialist. Identify spending patterns, price changes, or activity that appears unusual or potentially problematic. Present findings clearly without overstating severity — most anomalies are not fraud, but they deserve the user's attention. Do not analyze general trends or classify transactions.`,
  allowedToolNames: [
    'find_spending_anomalies',
    'detect_subscription_price_changes',
    'search_transactions',
  ],
};

export default riskAnomalyAgent;
