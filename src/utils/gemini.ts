import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from './config';

type GenerateGeminiInsightArgs = {
  apiKey?: string;
  context: string;
  prompt: string;
  systemInstruction: string;
  maxOutputTokens: number;
  model?: string;
};

const DEFAULT_MODEL = 'gemini-2.5-flash';
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const DAILY_QUOTA_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const SUPPRESSION_LOG_INTERVAL_MS = 5 * 60 * 1000;

const blockedUntilByModel = new Map<string, number>();
const lastSuppressionLogByModel = new Map<string, number>();

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

const logSuppressed = (model: string, context: string, blockedUntil: number): void => {
  const now = Date.now();
  const lastLoggedAt = lastSuppressionLogByModel.get(model) ?? 0;
  if (now - lastLoggedAt < SUPPRESSION_LOG_INTERVAL_MS) return;

  lastSuppressionLogByModel.set(model, now);
  console.warn(
    `Skipping Gemini insight (${context}) while ${model} is rate-limited until ${new Date(blockedUntil).toISOString()}`
  );
};

// ─── Ollama one-shot insight ─────────────────────────────────────────────────

const generateOllamaInsight = async ({
  context,
  prompt,
  systemInstruction,
  maxOutputTokens,
}: Pick<GenerateGeminiInsightArgs, 'context' | 'prompt' | 'systemInstruction' | 'maxOutputTokens'>): Promise<string> => {
  try {
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
  } catch (err: unknown) {
    console.error(`Ollama insight error (${context}):`, getErrorMessage(err));
    return '';
  }
};

// ─── Main export — routes to Ollama in dev, Gemini in prod ──────────────────

export const generateGeminiInsight = async ({
  apiKey,
  context,
  prompt,
  systemInstruction,
  maxOutputTokens,
  model = DEFAULT_MODEL,
}: GenerateGeminiInsightArgs): Promise<string> => {
  // Use Ollama when OLLAMA_MODEL is set (works in dev and containerised deployments)
  if (process.env.OLLAMA_MODEL) {
    return generateOllamaInsight({ context, prompt, systemInstruction, maxOutputTokens });
  }

  if (!apiKey) return '';

  const blockedUntil = blockedUntilByModel.get(model);
  if (blockedUntil && blockedUntil > Date.now()) {
    logSuppressed(model, context, blockedUntil);
    return '';
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const generativeModel = genAI.getGenerativeModel({
      model,
      generationConfig: { maxOutputTokens },
      systemInstruction,
    });

    const result = await generativeModel.generateContent(prompt);
    blockedUntilByModel.delete(model);
    return result.response.text().trim();
  } catch (err: unknown) {
    const message = getErrorMessage(err);

    if (isRateLimited(message)) {
      const retryAt = Date.now() + getCooldownMs(message);
      blockedUntilByModel.set(model, retryAt);
      console.warn(`Gemini insight unavailable (${context}): ${message}`);
      return '';
    }

    console.error(`Gemini insight error (${context}):`, message);
    return '';
  }
};
