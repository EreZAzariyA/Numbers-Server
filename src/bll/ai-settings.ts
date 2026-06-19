import cacheService from '../utils/cache-service';
import { createOllamaClient } from '../utils/ollama-client';
import { UserAiSettings, type AiProvider, type IUserAiSettingsCollection } from '../collections/UserAiSettings';
import { ClientError } from '../models';
import { decryptAiSecret, encryptAiSecret, maskAiSecret } from '../utils/ai-secrets';
import {
  checkClaudeKey,
  checkGeminiKey,
  listClaudeModels as fetchClaudeModels,
  listGeminiModels as fetchGeminiModels,
  type ProviderHealthStatus,
} from '../utils/ai-provider-health';

const OLLAMA_API_KEY = 'ollama';

export type EmbeddingProviderConfig =
  | { provider: 'gemini'; apiKey: string; model: string }
  | { provider: 'ollama'; model: string };

type AiProviderSource = 'user' | 'env' | 'missing';

type AiProviderStatus = {
  provider: AiProvider;
  available: boolean;
  source: AiProviderSource;
  maskedKey: string | null;
  model: string | null;
};

type AiSettingsResponse = {
  provider: AiProvider;
  providers: Record<AiProvider, AiProviderStatus>;
  ollamaThinking: boolean;
};

type AiProviderHealth = {
  status: ProviderHealthStatus;
  checkedAt: string;
  error?: string;
};

type AiHealthResponse = Record<AiProvider, AiProviderHealth>;

type ResolvedAiProvider = {
  provider: AiProvider;
  available: boolean;
  source: AiProviderSource;
  apiKey: string | null;
  model: string | null;
  thinking: boolean;
};

const PROVIDERS: AiProvider[] = ['ollama', 'gemini', 'claude'];
const LANGUAGES = ['en', 'he'];
const HEALTH_CACHE_TTL_SECONDS = 60;
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

const getOllamaModel = (): string | null => process.env.OLLAMA_MODEL || null;

const resolveOllamaModel = (doc?: IUserAiSettingsCollection | null): string | null =>
  doc?.ollamaModel || getOllamaModel();

const resolveGeminiModel = (doc?: IUserAiSettingsCollection | null): string =>
  doc?.geminiModel || DEFAULT_GEMINI_MODEL;

const resolveClaudeModel = (doc?: IUserAiSettingsCollection | null): string =>
  doc?.claudeModel || DEFAULT_CLAUDE_MODEL;

// Thinking (reasoning) is on by default; only an explicit `false` disables it.
const resolveOllamaThinking = (doc?: IUserAiSettingsCollection | null): boolean =>
  doc?.ollamaThinking !== false;

class AiSettingsLogic {
  private getDefaultProvider(): AiProvider {
    if (getOllamaModel()) return 'ollama';
    return 'gemini';
  }

  private buildProviderStatuses(doc?: IUserAiSettingsCollection | null): AiSettingsResponse['providers'] {
    const geminiUserKey = decryptAiSecret(doc?.geminiApiKey);
    const claudeUserKey = decryptAiSecret(doc?.claudeApiKey);

    return {
      ollama: {
        provider: 'ollama',
        available: !!getOllamaModel(),
        source: doc?.ollamaModel ? 'user' : (getOllamaModel() ? 'env' : 'missing'),
        maskedKey: null,
        model: resolveOllamaModel(doc),
      },
      gemini: {
        provider: 'gemini',
        available: !!geminiUserKey,
        source: geminiUserKey ? 'user' : 'missing',
        maskedKey: geminiUserKey ? maskAiSecret(geminiUserKey) : null,
        model: resolveGeminiModel(doc),
      },
      claude: {
        provider: 'claude',
        available: !!claudeUserKey,
        source: claudeUserKey ? 'user' : 'missing',
        maskedKey: claudeUserKey ? maskAiSecret(claudeUserKey) : null,
        model: resolveClaudeModel(doc),
      },
    };
  }

  private getEffectiveProvider(provider: AiProvider | undefined, providers: AiSettingsResponse['providers']): AiProvider {
    if (provider && providers[provider]?.available) return provider;
    const firstAvailable = PROVIDERS.find((candidate) => providers[candidate].available);
    return firstAvailable || provider || this.getDefaultProvider();
  }

  private async ensureDocument(user_id: string): Promise<IUserAiSettingsCollection> {
    const existing = await UserAiSettings.findOne({ user_id }).exec();
    if (existing) return existing;

    const created = await UserAiSettings.findOneAndUpdate(
      { user_id },
      { $setOnInsert: { user_id, provider: this.getDefaultProvider() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
    if (!created) {
      throw new ClientError(500, 'Failed to initialize AI settings.');
    }
    return created;
  }

  private async invalidateUserAiCaches(user_id: string): Promise<void> {
    const keys = [
      `ai-settings:${user_id}`,
      `ai-health:${user_id}`,
      ...LANGUAGES.map((language) => `forecast:${user_id}:${language}`),
      ...LANGUAGES.map((language) => `financialHealth:${user_id}:${language}`),
      ...LANGUAGES.map((language) => `savingsGoals:${user_id}:${language}`),
    ];

    await Promise.all(keys.map((key) => cacheService.del(key)));
  }

  async getSettings(user_id: string): Promise<AiSettingsResponse> {
    const cacheKey = `ai-settings:${user_id}`;
    const cached = await cacheService.get<AiSettingsResponse>(cacheKey);
    if (cached) return cached;

    const doc = await UserAiSettings.findOne({ user_id }).exec();
    const providers = this.buildProviderStatuses(doc);
    const response: AiSettingsResponse = {
      provider: this.getEffectiveProvider(doc?.provider, providers),
      providers,
      ollamaThinking: resolveOllamaThinking(doc),
    };

    await cacheService.set(cacheKey, response, 120);
    return response;
  }

  private async checkOllamaHealth(): Promise<AiProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (!getOllamaModel()) return { status: 'unknown', checkedAt };
    const models = await this.listOllamaModels();
    return models.length > 0
      ? { status: 'ok', checkedAt }
      : { status: 'error', checkedAt, error: 'Ollama is unreachable or has no models installed.' };
  }

  async getProviderHealth(user_id: string): Promise<AiHealthResponse> {
    const cacheKey = `ai-health:${user_id}`;
    const cached = await cacheService.get<AiHealthResponse>(cacheKey);
    if (cached) return cached;

    const doc = await UserAiSettings.findOne({ user_id }).exec();
    const geminiKey = decryptAiSecret(doc?.geminiApiKey) || '';
    const claudeKey = decryptAiSecret(doc?.claudeApiKey) || '';
    const checkedAt = new Date().toISOString();

    const [ollama, gemini, claude] = await Promise.all([
      this.checkOllamaHealth(),
      checkGeminiKey(geminiKey),
      checkClaudeKey(claudeKey),
    ]);

    const response: AiHealthResponse = {
      ollama,
      gemini: { ...gemini, checkedAt },
      claude: { ...claude, checkedAt },
    };

    await cacheService.set(cacheKey, response, HEALTH_CACHE_TTL_SECONDS);
    return response;
  }

  async updateProvider(user_id: string, provider: AiProvider): Promise<AiSettingsResponse> {
    const settings = await this.getSettings(user_id);
    if (!settings.providers[provider]) {
      throw new ClientError(400, 'Unsupported AI provider.');
    }
    if (!settings.providers[provider].available) {
      throw new ClientError(409, 'The selected AI provider is not configured.');
    }

    await UserAiSettings.findOneAndUpdate(
      { user_id },
      { $set: { provider }, $setOnInsert: { user_id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();

    await this.invalidateUserAiCaches(user_id);
    return this.getSettings(user_id);
  }

  async listOllamaModels(): Promise<string[]> {
    try {
      const client = createOllamaClient();
      const response = await client.models.list();
      return response.data.map((entry) => entry.id).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  async listGeminiModels(user_id: string): Promise<string[]> {
    const doc = await UserAiSettings.findOne({ user_id }).exec();
    const apiKey = decryptAiSecret(doc?.geminiApiKey);
    if (!apiKey) throw new ClientError(400, 'Gemini API key is not configured.');
    return fetchGeminiModels(apiKey);
  }

  async listClaudeModels(user_id: string): Promise<string[]> {
    const doc = await UserAiSettings.findOne({ user_id }).exec();
    const apiKey = decryptAiSecret(doc?.claudeApiKey);
    if (!apiKey) throw new ClientError(400, 'Claude API key is not configured.');
    return fetchClaudeModels(apiKey);
  }

  async updateProviderModel(user_id: string, provider: Extract<AiProvider, 'gemini' | 'claude'>, model: string): Promise<AiSettingsResponse> {
    if (provider !== 'gemini' && provider !== 'claude') {
      throw new ClientError(400, 'Provider must be gemini or claude.');
    }
    const trimmedModel = model?.trim();
    if (!trimmedModel) {
      throw new ClientError(400, 'Model is required.');
    }

    const field = provider === 'gemini' ? 'geminiModel' : 'claudeModel';
    await UserAiSettings.findOneAndUpdate(
      { user_id },
      { $set: { [field]: trimmedModel }, $setOnInsert: { user_id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();

    await this.invalidateUserAiCaches(user_id);
    return this.getSettings(user_id);
  }

  async updateOllamaModel(user_id: string, model: string): Promise<AiSettingsResponse> {
    const trimmedModel = model?.trim();
    if (!trimmedModel) {
      throw new ClientError(400, 'Ollama model is required.');
    }

    await UserAiSettings.findOneAndUpdate(
      { user_id },
      { $set: { ollamaModel: trimmedModel, provider: 'ollama' }, $setOnInsert: { user_id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();

    await this.invalidateUserAiCaches(user_id);
    return this.getSettings(user_id);
  }

  async upsertProviderKey(user_id: string, provider: Extract<AiProvider, 'gemini' | 'claude'>, apiKey: string): Promise<AiSettingsResponse> {
    if (provider !== 'gemini' && provider !== 'claude') {
      throw new ClientError(400, 'Unsupported API-key provider.');
    }

    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) {
      throw new ClientError(400, 'API key is required.');
    }

    // Probe the key before persisting so a dead/typo'd key is rejected at save
    // time rather than silently surfacing later during a chat call.
    const health = provider === 'gemini'
      ? await checkGeminiKey(trimmedKey)
      : await checkClaudeKey(trimmedKey);
    if (health.status === 'error') {
      throw new ClientError(400, health.error || 'The provided API key could not be verified.');
    }

    const field = provider === 'gemini' ? 'geminiApiKey' : 'claudeApiKey';
    await UserAiSettings.findOneAndUpdate(
      { user_id },
      {
        $set: {
          [field]: encryptAiSecret(trimmedKey),
          provider,
        },
        $setOnInsert: { user_id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();

    await this.invalidateUserAiCaches(user_id);
    return this.getSettings(user_id);
  }

  async removeProviderKey(user_id: string, provider: Extract<AiProvider, 'gemini' | 'claude'>): Promise<AiSettingsResponse> {
    if (provider !== 'gemini' && provider !== 'claude') {
      throw new ClientError(400, 'Unsupported API-key provider.');
    }

    const field = provider === 'gemini' ? 'geminiApiKey' : 'claudeApiKey';
    const doc = await this.ensureDocument(user_id);

    doc.set(field, undefined);
    const providers = this.buildProviderStatuses(doc);
    doc.provider = this.getEffectiveProvider(doc.provider, providers);
    await doc.save();

    await this.invalidateUserAiCaches(user_id);
    return this.getSettings(user_id);
  }

  async resolveProvider(user_id: string): Promise<ResolvedAiProvider> {
    const doc = await UserAiSettings.findOne({ user_id }).exec();
    const providers = this.buildProviderStatuses(doc);
    const provider = this.getEffectiveProvider(doc?.provider, providers);
    const status = providers[provider];

    if (provider === 'ollama') {
      return {
        provider,
        available: status.available,
        source: status.source,
        apiKey: status.available ? OLLAMA_API_KEY : null,
        model: resolveOllamaModel(doc),
        thinking: resolveOllamaThinking(doc),
      };
    }

    const userApiKey = provider === 'gemini'
      ? decryptAiSecret(doc?.geminiApiKey)
      : decryptAiSecret(doc?.claudeApiKey);

    return {
      provider,
      available: !!userApiKey,
      source: userApiKey ? 'user' : 'missing',
      apiKey: userApiKey || null,
      model: status.model,
      thinking: resolveOllamaThinking(doc),
    };
  }

  async resolveEmbeddingProvider(user_id: string): Promise<EmbeddingProviderConfig | null> {
    const doc = await UserAiSettings.findOne({ user_id }).exec();

    // Gemini is preferred: fixed 768-dim output, no extra model setup required.
    const geminiKey = decryptAiSecret(doc?.geminiApiKey);
    if (geminiKey) {
      return { provider: 'gemini', apiKey: geminiKey, model: 'text-embedding-004' };
    }

    // Fall back to Ollama when configured. The chat model is reused; the caller
    // validates the returned dimension and skips saving if it does not match 768.
    const ollamaModel = resolveOllamaModel(doc);
    if (ollamaModel) {
      return { provider: 'ollama', model: ollamaModel };
    }

    return null;
  }

  async updateOllamaThinking(user_id: string, enabled: boolean): Promise<AiSettingsResponse> {
    await UserAiSettings.findOneAndUpdate(
      { user_id },
      { $set: { ollamaThinking: enabled }, $setOnInsert: { user_id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();

    await this.invalidateUserAiCaches(user_id);
    return this.getSettings(user_id);
  }
}

const aiSettingsLogic = new AiSettingsLogic();

export { getOllamaModel };
export type { AiProvider };
export default aiSettingsLogic;
