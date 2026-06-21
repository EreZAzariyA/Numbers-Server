import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Types } from 'mongoose';
import { toDateStr, addDays } from '../../utils/date-helpers';
import { createOllamaClient } from '../../utils/ollama-client';
import aiSettingsLogic from '../ai-settings';
import agentInsightsLogic from '../agent-insights';
import { Notifications } from '../../collections';
import type { InsightFinding } from '../../models';
import type { INotificationModel } from '../../models/notification-model';

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

const sortBySeverity = (findings: InsightFinding[]): InsightFinding[] =>
  [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  );

const buildPrompt = (
  language: 'en' | 'he',
  findings: InsightFinding[],
  notifications: INotificationModel[],
): string => {
  const languageLabel = language === 'he' ? 'Hebrew (עברית)' : 'English';

  const findingsBlock = findings.length > 0
    ? sortBySeverity(findings)
        .map((f) => `- [${f.severity}] ${f.title}: ${f.body}`)
        .join('\n')
    : 'No findings.';

  const notificationsBlock = notifications.length > 0
    ? notifications.map((n) => `- ${n.title}: ${n.body}`).join('\n')
    : '';

  const alertsSection = notificationsBlock
    ? `\nRecent alerts:\n${notificationsBlock}`
    : '';

  return `You are a personal finance assistant. The following findings were detected from background analysis of the user's finances.

Please write a concise, friendly financial digest of 2-3 sentences (max 150 words) summarizing the most important insights for the user. Focus on actionable insights and anything that requires attention. Write in ${languageLabel}.

Findings (sorted by severity):
${findingsBlock}${alertsSection}`;
};

const callOllama = async (prompt: string, model: string): Promise<string> => {
  const client = createOllamaClient();
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.choices[0]?.message?.content ?? '';
};

const callClaude = async (prompt: string, apiKey: string, model: string): Promise<string> => {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
};

const callGemini = async (prompt: string, apiKey: string, model: string): Promise<string> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });
  const result = await geminiModel.generateContent(prompt);
  return result.response.text();
};

export async function generateDashboardDigest(user_id: string, language: 'en' | 'he'): Promise<void> {
  const today = toDateStr(new Date());
  const yesterday = addDays(today, -1);
  const threeDaysAgo = addDays(today, -3);

  let allFindings: InsightFinding[] = [];

  try {
    const [recentFindings, recentNotifications] = await Promise.all([
      agentInsightsLogic.getRecentFindings(user_id, yesterday),
      Notifications.find({
        user_id: new Types.ObjectId(user_id),
        read: false,
        createdAt: { $gte: new Date(threeDaysAgo) },
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean<INotificationModel[]>()
        .exec(),
    ]);

    allFindings = recentFindings.flatMap((doc) => doc.findings);

    const runtime = await aiSettingsLogic.resolveProvider(user_id);

    if (!runtime.available || !runtime.model) {
      await agentInsightsLogic.upsert(user_id, 'dashboard-digest', today, allFindings);
      return;
    }

    if (allFindings.length === 0 && recentNotifications.length === 0) {
      await agentInsightsLogic.upsert(
        user_id,
        'dashboard-digest',
        today,
        [],
        'No significant financial activity detected recently.',
      );
      return;
    }

    const prompt = buildPrompt(language, allFindings, recentNotifications);

    let aiSummary: string;

    if (runtime.provider === 'ollama') {
      aiSummary = await callOllama(prompt, runtime.model);
    } else if (runtime.provider === 'claude') {
      aiSummary = await callClaude(prompt, runtime.apiKey!, runtime.model);
    } else {
      aiSummary = await callGemini(prompt, runtime.apiKey!, runtime.model);
    }

    await agentInsightsLogic.upsert(user_id, 'dashboard-digest', today, allFindings, aiSummary);
  } catch (err: unknown) {
    await agentInsightsLogic.upsert(user_id, 'dashboard-digest', today, allFindings);
  }
}
