import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createOllamaClient } from '../utils/ollama-client';
import type { AgentDefinition, AgentId, ClassificationResult } from './agents/agent-definition';
import type { AgentToolDefinition, SupportedLanguage } from './agent/tool-types';
import financialAnalystAgent from './agents/financial-analyst.agent';
import budgetPlanningAgent from './agents/budget-planning.agent';
import cashFlowAgent from './agents/cash-flow.agent';
import spendingInsightsAgent from './agents/spending-insights.agent';
import categorizationAgent from './agents/categorization.agent';
import riskAnomalyAgent from './agents/risk-anomaly.agent';
import reportingAgent from './agents/reporting.agent';
import userChatAgent from './agents/user-chat.agent';

const ALL_AGENTS: AgentDefinition[] = [
  financialAnalystAgent,
  budgetPlanningAgent,
  cashFlowAgent,
  spendingInsightsAgent,
  categorizationAgent,
  riskAnomalyAgent,
  reportingAgent,
  userChatAgent,
];

const AGENT_REGISTRY = new Map<AgentId, AgentDefinition>(
  ALL_AGENTS.map((agent) => [agent.id, agent]),
);

const FALLBACK_RESULT: ClassificationResult = {
  agentIds: ['user_chat'],
  confidence: 0,
  reasoning: 'Classification failed — falling back to user_chat',
};

function buildClassificationSystemPrompt(): string {
  const agentList = ALL_AGENTS.filter((a) => a.id !== 'user_chat')
    .map((a) => `- ${a.id}: ${a.role}`)
    .join('\n');

  return `You are the Manager Agent for a personal finance assistant.
Analyze the user message and select which specialist agents should handle it.

Available agents:
${agentList}
- user_chat: Greetings, capability questions, general conversational help

Return ONLY valid JSON with no explanation:
{ "agents": ["id1", "id2"], "confidence": 0.95, "reasoning": "one sentence" }

Select the minimum number of agents required to answer the user's request accurately.
Typical range: 1–3 agents. Prefer specialist agents over user_chat whenever financial data may help.
The goal is not to maximize agents selected — select the smallest set necessary for the best answer.`;
}

function parseClassificationJson(raw: string): ClassificationResult | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { agents?: unknown; confidence?: unknown; reasoning?: unknown };
    if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) return null;
    const validIds = parsed.agents.filter((id): id is AgentId => AGENT_REGISTRY.has(id as AgentId));
    if (validIds.length === 0) return null;
    return {
      agentIds: validIds,
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    };
  } catch {
    return null;
  }
}

type ProviderRuntime = {
  provider: string;
  model: string | null;
  apiKey?: string | null;
  thinking?: boolean;
};

class AgentManager {
  async classify(
    message: string,
    language: SupportedLanguage,
    runtime: ProviderRuntime,
  ): Promise<ClassificationResult> {
    const systemPrompt = buildClassificationSystemPrompt();
    let raw: string | null = null;

    try {
      if (runtime.provider === 'ollama') {
        raw = await this.classifyWithOllama(message, systemPrompt, runtime.model!);
      } else if (runtime.provider === 'claude') {
        raw = await this.classifyWithClaude(message, systemPrompt, runtime);
      } else {
        raw = await this.classifyWithGemini(message, systemPrompt, runtime);
      }
    } catch {
      return FALLBACK_RESULT;
    }

    if (!raw) return FALLBACK_RESULT;

    const first = parseClassificationJson(raw);
    if (first) return first;

    try {
      const correctionPrompt = `Your previous response was not valid JSON. Return ONLY: { "agents": ["id"], "confidence": 0.8, "reasoning": "reason" }`;
      if (runtime.provider === 'ollama') {
        raw = await this.classifyWithOllama(`${message}\n\n${correctionPrompt}`, systemPrompt, runtime.model!);
      } else if (runtime.provider === 'claude') {
        raw = await this.classifyWithClaude(`${message}\n\n${correctionPrompt}`, systemPrompt, runtime);
      } else {
        raw = await this.classifyWithGemini(`${message}\n\n${correctionPrompt}`, systemPrompt, runtime);
      }
    } catch {
      return FALLBACK_RESULT;
    }

    return parseClassificationJson(raw ?? '') ?? FALLBACK_RESULT;
  }

  private async classifyWithOllama(message: string, systemPrompt: string, model: string): Promise<string> {
    const client = createOllamaClient();
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: `/no_think\n${systemPrompt}` },
        { role: 'user', content: message },
      ],
    });
    return response.choices[0].message.content ?? '';
  }

  private async classifyWithClaude(message: string, systemPrompt: string, runtime: ProviderRuntime): Promise<string> {
    const client = new Anthropic({ apiKey: runtime.apiKey! });
    const response = await client.messages.create({
      model: runtime.model!,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  private async classifyWithGemini(message: string, systemPrompt: string, runtime: ProviderRuntime): Promise<string> {
    const genAI = new GoogleGenerativeAI(runtime.apiKey!);
    const geminiModel = genAI.getGenerativeModel({ model: runtime.model!, systemInstruction: systemPrompt });
    const result = await geminiModel.generateContent(message);
    return result.response.text();
  }

  compose(
    agentIds: AgentId[],
    allTools: AgentToolDefinition[],
  ): { systemPromptSegment: string; tools: AgentToolDefinition[] } {
    const definitions = agentIds
      .map((id) => AGENT_REGISTRY.get(id))
      .filter((def): def is AgentDefinition => def !== undefined);

    const systemPromptSegment = definitions
      .map((def) => def.systemPromptSegment)
      .join('\n\n---\n\n');

    const allowedNames = new Set(definitions.flatMap((def) => def.allowedToolNames));
    const tools = allTools.filter((tool) => allowedNames.has(tool.name));

    return { systemPromptSegment, tools };
  }

  getAgentName(id: AgentId, language: SupportedLanguage): string {
    const def = AGENT_REGISTRY.get(id);
    if (!def) return id;
    return language === 'he' ? def.name.he : def.name.en;
  }
}

export const agentManager = new AgentManager();
export type { ProviderRuntime };
