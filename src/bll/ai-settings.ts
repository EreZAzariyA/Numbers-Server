import cacheService from '../utils/cache-service';
import { UserAiSettings, type AiProvider, type IUserAiSettingsCollection } from '../collections/UserAiSettings';
import { ClientError } from '../models';
import { decryptAiSecret, encryptAiSecret, maskAiSecret } from '../utils/ai-secrets';

type AiProviderSource = 'user' | 'env' | 'missing';

export type AiProviderStatus = {
  provider: AiProvider;
  available: boolean;
  source: AiProviderSource;
  maskedKey: string | null;
  model: string | null;
};

export type AiSettingsResponse = {
  provider: AiProvider;
  providers: Record<AiProvider, AiProviderStatus>;
};

export type ResolvedAiProvider = {
  provider: AiProvider;
  available: boolean;
  source: AiProviderSource;
  apiKey: string | null;
  model: string | null;
};

const PROVIDERS: AiProvider[] = ['ollama', 'gemini', 'claude'];
const LANGUAGES = ['en', 'he'];

const getOllamaModel = (): string | null => process.env.OLLAMA_MODEL || null;
const getGeminiModel = (): string => process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const getClaudeModel = (): string => process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest';

class AiSettingsLogic {
  private getDefaultProvider(): AiProvider {
    if (getOllamaModel()) return 'ollama';
    if (process.env.GEMINI_API_KEY) return 'gemini';
    if (process.env.CLAUDE_API_KEY) return 'claude';
    return 'gemini';
  }

  private buildProviderStatuses(doc?: IUserAiSettingsCollection | null): AiSettingsResponse['providers'] {
    const geminiUserKey = decryptAiSecret(doc?.geminiApiKey);
    const claudeUserKey = decryptAiSecret(doc?.claudeApiKey);

    return {
      ollama: {
        provider: 'ollama',
        available: !!getOllamaModel(),
        source: getOllamaModel() ? 'env' : 'missing',
        maskedKey: null,
        model: getOllamaModel(),
      },
      gemini: {
        provider: 'gemini',
        available: !!(geminiUserKey || process.env.GEMINI_API_KEY),
        source: geminiUserKey ? 'user' : (process.env.GEMINI_API_KEY ? 'env' : 'missing'),
        maskedKey: geminiUserKey ? maskAiSecret(geminiUserKey) : null,
        model: getGeminiModel(),
      },
      claude: {
        provider: 'claude',
        available: !!(claudeUserKey || process.env.CLAUDE_API_KEY),
        source: claudeUserKey ? 'user' : (process.env.CLAUDE_API_KEY ? 'env' : 'missing'),
        maskedKey: claudeUserKey ? maskAiSecret(claudeUserKey) : null,
        model: getClaudeModel(),
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
    };

    await cacheService.set(cacheKey, response, 120);
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

  async upsertProviderKey(user_id: string, provider: Extract<AiProvider, 'gemini' | 'claude'>, apiKey: string): Promise<AiSettingsResponse> {
    if (provider !== 'gemini' && provider !== 'claude') {
      throw new ClientError(400, 'Unsupported API-key provider.');
    }

    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) {
      throw new ClientError(400, 'API key is required.');
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
        apiKey: status.available ? 'ollama' : null,
        model: status.model,
      };
    }

    const userApiKey = provider === 'gemini'
      ? decryptAiSecret(doc?.geminiApiKey)
      : decryptAiSecret(doc?.claudeApiKey);
    const envApiKey = provider === 'gemini'
      ? process.env.GEMINI_API_KEY
      : process.env.CLAUDE_API_KEY;

    return {
      provider,
      available: !!(userApiKey || envApiKey),
      source: userApiKey ? 'user' : (envApiKey ? 'env' : 'missing'),
      apiKey: userApiKey || envApiKey || null,
      model: status.model,
    };
  }
}

const aiSettingsLogic = new AiSettingsLogic();

export { getClaudeModel, getGeminiModel, getOllamaModel };
export type { AiProvider };
export default aiSettingsLogic;
