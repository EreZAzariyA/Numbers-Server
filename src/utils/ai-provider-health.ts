import Anthropic from '@anthropic-ai/sdk';

export type ProviderHealthStatus = 'ok' | 'error' | 'unknown';

type ProviderHealthResult = {
  status: ProviderHealthStatus;
  error?: string;
};

type GeminiModelEntry = {
  name: string;
  supportedGenerationMethods: string[];
};

type GeminiModelsResponse = {
  models?: GeminiModelEntry[];
};

const HEALTH_CHECK_TIMEOUT_MS = 8000;
const MAX_ERROR_LENGTH = 200;
const GEMINI_MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const UNKNOWN_RESULT: ProviderHealthResult = { status: 'unknown' };

const sanitizeError = (message: string): string =>
  message.replace(/^error:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_LENGTH);

const toErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err ?? 'Unknown error');
};

// Validates a Gemini key with a token-free models.list REST call (the SDK does
// not expose listing). A 200 means the key is live; any other status surfaces
// the provider's own error message.
export const checkGeminiKey = async (apiKey: string): Promise<ProviderHealthResult> => {
  if (!apiKey) return UNKNOWN_RESULT;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${GEMINI_MODELS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal },
    );
    if (response.ok) return { status: 'ok' };

    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    const message = body?.error?.message || `HTTP ${response.status}`;
    return { status: 'error', error: sanitizeError(message) };
  } catch (err: unknown) {
    return { status: 'error', error: sanitizeError(toErrorMessage(err)) };
  } finally {
    clearTimeout(timeout);
  }
};

// Validates a Claude key with a token-free models.list call. A 401/403 throws
// and is reported as an error; success means the key is live.
export const checkClaudeKey = async (apiKey: string): Promise<ProviderHealthResult> => {
  if (!apiKey) return UNKNOWN_RESULT;

  try {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: HEALTH_CHECK_TIMEOUT_MS });
    await client.models.list({ limit: 1 });
    return { status: 'ok' };
  } catch (err: unknown) {
    return { status: 'error', error: sanitizeError(toErrorMessage(err)) };
  }
};

export const listGeminiModels = async (apiKey: string): Promise<string[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${GEMINI_MODELS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message || `HTTP ${response.status}`);
    }
    const data = (await response.json()) as GeminiModelsResponse;
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      .sort();
  } finally {
    clearTimeout(timeout);
  }
};

export const listClaudeModels = async (apiKey: string): Promise<string[]> => {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: HEALTH_CHECK_TIMEOUT_MS });
  const page = await client.models.list();
  return page.data.map((m) => m.id).sort();
};
