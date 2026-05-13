import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import aiSettingsLogic from '../bll/ai-settings';

type GenerateUserInsightArgs = {
  user_id: string;
  context: string;
  prompt: string;
  systemInstruction: string;
  maxOutputTokens: number;
};

type SupportedLanguage = 'en' | 'he';

const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const DAILY_QUOTA_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const SUPPRESSION_LOG_INTERVAL_MS = 5 * 60 * 1000;

const blockedUntilByKey = new Map<string, number>();
const lastSuppressionLogByKey = new Map<string, number>();

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err ?? '');
};

const isRateLimited = (message: string): boolean =>
  /429|too many requests|rate limit/i.test(message);

const isDailyQuotaExceeded = (message: string): boolean =>
  /perday|per day|free[_ -]?tier|quota exceeded/i.test(message);

const getCooldownMs = (message: string): number =>
  isDailyQuotaExceeded(message) ? DAILY_QUOTA_COOLDOWN_MS : RATE_LIMIT_COOLDOWN_MS;

const sanitizeProviderErrorMessage = (message: string): string =>
  message
    .replace(/^error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

export const getAiRateLimitMessage = (err: unknown, language: SupportedLanguage): string | null => {
  const rawMessage = sanitizeProviderErrorMessage(getErrorMessage(err));
  if (!rawMessage) return null;
  if (!isRateLimited(rawMessage) && !isDailyQuotaExceeded(rawMessage)) return null;

  if (isDailyQuotaExceeded(rawMessage)) {
    return language === 'he'
      ? `חרגת ממכסת השימוש היומית של ספק ה-AI: ${rawMessage}`
      : `The AI provider daily quota was reached: ${rawMessage}`;
  }

  return language === 'he'
    ? `הגעת למגבלת הקצב של ספק ה-AI: ${rawMessage}`
    : `The AI provider rate limit was reached: ${rawMessage}`;
};

const logSuppressed = (key: string, context: string, blockedUntil: number): void => {
  const now = Date.now();
  const lastLoggedAt = lastSuppressionLogByKey.get(key) ?? 0;
  if (now - lastLoggedAt < SUPPRESSION_LOG_INTERVAL_MS) return;

  lastSuppressionLogByKey.set(key, now);
  console.warn(
    `Skipping AI insight (${context}) while ${key} is rate-limited until ${new Date(blockedUntil).toISOString()}`
  );
};

const generateOllamaInsight = async ({
  prompt,
  systemInstruction,
  maxOutputTokens,
}: Pick<GenerateUserInsightArgs, 'prompt' | 'systemInstruction' | 'maxOutputTokens'>): Promise<string> => {
  const client = new OpenAI({
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    apiKey: 'ollama',
  });

  const response = await client.chat.completions.create({
    model: process.env.OLLAMA_MODEL!,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxOutputTokens,
  });

  return response.choices[0].message.content?.trim() ?? '';
};

const generateGeminiInsight = async ({
  apiKey,
  prompt,
  systemInstruction,
  maxOutputTokens,
  model,
}: {
  apiKey: string;
  prompt: string;
  systemInstruction: string;
  maxOutputTokens: number;
  model: string;
}): Promise<string> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model,
    generationConfig: { maxOutputTokens },
    systemInstruction,
  });

  const result = await generativeModel.generateContent(prompt);
  return result.response.text().trim();
};

const generateClaudeInsight = async ({
  apiKey,
  prompt,
  systemInstruction,
  maxOutputTokens,
  model,
}: {
  apiKey: string;
  prompt: string;
  systemInstruction: string;
  maxOutputTokens: number;
  model: string;
}): Promise<string> => {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: maxOutputTokens,
    system: systemInstruction,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n')
    .trim();
};

export const generateUserInsight = async ({
  user_id,
  context,
  prompt,
  systemInstruction,
  maxOutputTokens,
}: GenerateUserInsightArgs): Promise<string> => {
  const runtime = await aiSettingsLogic.resolveProvider(user_id);
  if (!runtime.available || !runtime.model) return '';

  const suppressionKey = `${runtime.provider}:${runtime.model}`;
  const blockedUntil = blockedUntilByKey.get(suppressionKey);
  if (blockedUntil && blockedUntil > Date.now()) {
    logSuppressed(suppressionKey, context, blockedUntil);
    return '';
  }

  try {
    let response = '';

    if (runtime.provider === 'ollama') {
      response = await generateOllamaInsight({ prompt, systemInstruction, maxOutputTokens });
    } else if (runtime.provider === 'gemini' && runtime.apiKey) {
      response = await generateGeminiInsight({
        apiKey: runtime.apiKey,
        prompt,
        systemInstruction,
        maxOutputTokens,
        model: runtime.model,
      });
    } else if (runtime.provider === 'claude' && runtime.apiKey) {
      response = await generateClaudeInsight({
        apiKey: runtime.apiKey,
        prompt,
        systemInstruction,
        maxOutputTokens,
        model: runtime.model,
      });
    }

    blockedUntilByKey.delete(suppressionKey);
    return response;
  } catch (err: unknown) {
    const message = getErrorMessage(err);

    if (isRateLimited(message)) {
      const retryAt = Date.now() + getCooldownMs(message);
      blockedUntilByKey.set(suppressionKey, retryAt);
      console.warn(`AI insight unavailable (${context}): ${message}`);
      return '';
    }

    console.error(`AI insight error (${context}):`, message);
    return '';
  }
};
