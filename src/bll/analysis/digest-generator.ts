import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Types } from 'mongoose';
import { toDateStr, addDays } from '../../utils/date-helpers';
import { createOllamaClient } from '../../utils/ollama-client';
import config from '../../utils/config';
import aiSettingsLogic from '../ai-settings';
import agentInsightsLogic from '../agent-insights';
import { Notifications } from '../../collections';
import type { InsightFinding } from '../../models';
import type { INotificationModel } from '../../models/notification-model';

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };
const NO_ACTIVITY_EN = 'No significant financial activity detected recently.';
const NO_ACTIVITY_HE = 'לא זוהתה פעילות פיננסית משמעותית לאחרונה.';

type ResolvedRuntime = Awaited<ReturnType<typeof aiSettingsLogic.resolveProvider>>;

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

  const findingsBlock =
    findings.length > 0
      ? sortBySeverity(findings)
          .map((f) => `- [${f.severity}] ${f.title}: ${f.body}`)
          .join('\n')
      : 'No findings.';

  const notificationsBlock =
    notifications.length > 0
      ? notifications.map((n) => (n.body ? `- ${n.title}: ${n.body}` : `- ${n.title}`)).join('\n')
      : '';

  const alertsSection = notificationsBlock
    ? `\nRecent alerts:\n${notificationsBlock}`
    : '';

  const merchantNote = language === 'en'
    ? '\nNote: Merchant names may appear in Hebrew (they are proper nouns from an Israeli bank — keep them in quotes as-is, do not translate or transliterate them).'
    : '';

  return `You are a personal finance assistant. The following findings were detected from background analysis of the user's finances.

Please write a concise, friendly financial digest of 2-3 sentences (max 150 words) summarizing the most important insights for the user. Focus on actionable insights and anything that requires attention. Write in ${languageLabel}.${merchantNote}

Findings (sorted by severity):
${findingsBlock}${alertsSection}`;
};

const callOllama = async (prompt: string, model: string, thinking: boolean): Promise<string> => {
  const client = createOllamaClient();
  const effectivePrompt = thinking ? prompt : `/no_think\n${prompt}`;
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: effectivePrompt }],
  });
  return response.choices[0]?.message?.content ?? '';
};

const callClaude = async (prompt: string, apiKey: string, model: string): Promise<string> => {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 512,
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

const callProvider = async (
  runtime: ResolvedRuntime,
  prompt: string,
): Promise<string | null> => {
  if (runtime.provider === 'ollama') {
    return callOllama(prompt, runtime.model!, runtime.thinking ?? true);
  }
  if (!runtime.apiKey) return null;
  if (runtime.provider === 'claude') return callClaude(prompt, runtime.apiKey, runtime.model!);
  return callGemini(prompt, runtime.apiKey, runtime.model!);
};

export async function generateDashboardDigest(user_id: string): Promise<void> {
  const today = toDateStr(new Date());
  const yesterday = addDays(today, -1);
  const threeDaysAgo = addDays(today, -3);

  let allFindings_en: InsightFinding[] = [];
  let allFindings_he: InsightFinding[] = [];

  try {
    const [recentFindings_en, recentFindings_he, recentNotifications] = await Promise.all([
      agentInsightsLogic.getRecentFindings(user_id, yesterday, 'en'),
      agentInsightsLogic.getRecentFindings(user_id, yesterday, 'he'),
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

    allFindings_en = recentFindings_en.flatMap((doc) => doc.findings);
    allFindings_he = recentFindings_he.flatMap((doc) => doc.findings);

    const runtime = await aiSettingsLogic.resolveProvider(user_id);

    if (!runtime.available || !runtime.model) {
      await Promise.all([
        agentInsightsLogic.upsert(user_id, 'dashboard-digest', today, allFindings_en, undefined, 'en'),
        agentInsightsLogic.upsert(user_id, 'dashboard-digest', today, allFindings_he, undefined, 'he'),
      ]);
      return;
    }

    if (allFindings_en.length === 0 && recentNotifications.length === 0) {
      await Promise.all([
        agentInsightsLogic.upsert(user_id, 'dashboard-digest', today, [], NO_ACTIVITY_EN, 'en'),
        agentInsightsLogic.upsert(user_id, 'dashboard-digest', today, [], NO_ACTIVITY_HE, 'he'),
      ]);
      return;
    }

    const [aiSummary_en, aiSummary_he] = await Promise.all([
      callProvider(runtime, buildPrompt('en', allFindings_en, recentNotifications)),
      callProvider(runtime, buildPrompt('he', allFindings_he, recentNotifications)),
    ]);

    await Promise.all([
      agentInsightsLogic.upsert(
        user_id, 'dashboard-digest', today, allFindings_en, aiSummary_en ?? undefined, 'en',
      ),
      agentInsightsLogic.upsert(
        user_id, 'dashboard-digest', today, allFindings_he, aiSummary_he ?? undefined, 'he',
      ),
    ]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    config.log.error({ user_id }, `generateDashboardDigest failed: ${message}`);
    await Promise.all([
      agentInsightsLogic.upsert(user_id, 'dashboard-digest', today, allFindings_en, undefined, 'en'),
      agentInsightsLogic.upsert(user_id, 'dashboard-digest', today, allFindings_he, undefined, 'he'),
    ]);
  }
}
