"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOllamaModel = exports.getGeminiModel = exports.getClaudeModel = void 0;
const cache_service_1 = __importDefault(require("../utils/cache-service"));
const UserAiSettings_1 = require("../collections/UserAiSettings");
const models_1 = require("../models");
const ai_secrets_1 = require("../utils/ai-secrets");
const PROVIDERS = ['ollama', 'gemini', 'claude'];
const LANGUAGES = ['en', 'he'];
const getOllamaModel = () => process.env.OLLAMA_MODEL || null;
exports.getOllamaModel = getOllamaModel;
const getGeminiModel = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';
exports.getGeminiModel = getGeminiModel;
const getClaudeModel = () => process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest';
exports.getClaudeModel = getClaudeModel;
class AiSettingsLogic {
    getDefaultProvider() {
        if (getOllamaModel())
            return 'ollama';
        if (process.env.GEMINI_API_KEY)
            return 'gemini';
        if (process.env.CLAUDE_API_KEY)
            return 'claude';
        return 'gemini';
    }
    buildProviderStatuses(doc) {
        const geminiUserKey = (0, ai_secrets_1.decryptAiSecret)(doc === null || doc === void 0 ? void 0 : doc.geminiApiKey);
        const claudeUserKey = (0, ai_secrets_1.decryptAiSecret)(doc === null || doc === void 0 ? void 0 : doc.claudeApiKey);
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
                maskedKey: geminiUserKey ? (0, ai_secrets_1.maskAiSecret)(geminiUserKey) : null,
                model: getGeminiModel(),
            },
            claude: {
                provider: 'claude',
                available: !!(claudeUserKey || process.env.CLAUDE_API_KEY),
                source: claudeUserKey ? 'user' : (process.env.CLAUDE_API_KEY ? 'env' : 'missing'),
                maskedKey: claudeUserKey ? (0, ai_secrets_1.maskAiSecret)(claudeUserKey) : null,
                model: getClaudeModel(),
            },
        };
    }
    getEffectiveProvider(provider, providers) {
        var _a;
        if (provider && ((_a = providers[provider]) === null || _a === void 0 ? void 0 : _a.available))
            return provider;
        const firstAvailable = PROVIDERS.find((candidate) => providers[candidate].available);
        return firstAvailable || provider || this.getDefaultProvider();
    }
    ensureDocument(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            const existing = yield UserAiSettings_1.UserAiSettings.findOne({ user_id }).exec();
            if (existing)
                return existing;
            const created = yield UserAiSettings_1.UserAiSettings.findOneAndUpdate({ user_id }, { $setOnInsert: { user_id, provider: this.getDefaultProvider() } }, { upsert: true, new: true, setDefaultsOnInsert: true }).exec();
            if (!created) {
                throw new models_1.ClientError(500, 'Failed to initialize AI settings.');
            }
            return created;
        });
    }
    invalidateUserAiCaches(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            const keys = [
                `ai-settings:${user_id}`,
                ...LANGUAGES.map((language) => `forecast:${user_id}:${language}`),
                ...LANGUAGES.map((language) => `financialHealth:${user_id}:${language}`),
                ...LANGUAGES.map((language) => `savingsGoals:${user_id}:${language}`),
            ];
            yield Promise.all(keys.map((key) => cache_service_1.default.del(key)));
        });
    }
    getSettings(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            const cacheKey = `ai-settings:${user_id}`;
            const cached = yield cache_service_1.default.get(cacheKey);
            if (cached)
                return cached;
            const doc = yield UserAiSettings_1.UserAiSettings.findOne({ user_id }).exec();
            const providers = this.buildProviderStatuses(doc);
            const response = {
                provider: this.getEffectiveProvider(doc === null || doc === void 0 ? void 0 : doc.provider, providers),
                providers,
            };
            yield cache_service_1.default.set(cacheKey, response, 120);
            return response;
        });
    }
    updateProvider(user_id, provider) {
        return __awaiter(this, void 0, void 0, function* () {
            const settings = yield this.getSettings(user_id);
            if (!settings.providers[provider]) {
                throw new models_1.ClientError(400, 'Unsupported AI provider.');
            }
            if (!settings.providers[provider].available) {
                throw new models_1.ClientError(409, 'The selected AI provider is not configured.');
            }
            yield UserAiSettings_1.UserAiSettings.findOneAndUpdate({ user_id }, { $set: { provider }, $setOnInsert: { user_id } }, { upsert: true, new: true, setDefaultsOnInsert: true }).exec();
            yield this.invalidateUserAiCaches(user_id);
            return this.getSettings(user_id);
        });
    }
    upsertProviderKey(user_id, provider, apiKey) {
        return __awaiter(this, void 0, void 0, function* () {
            if (provider !== 'gemini' && provider !== 'claude') {
                throw new models_1.ClientError(400, 'Unsupported API-key provider.');
            }
            const trimmedKey = apiKey === null || apiKey === void 0 ? void 0 : apiKey.trim();
            if (!trimmedKey) {
                throw new models_1.ClientError(400, 'API key is required.');
            }
            const field = provider === 'gemini' ? 'geminiApiKey' : 'claudeApiKey';
            yield UserAiSettings_1.UserAiSettings.findOneAndUpdate({ user_id }, {
                $set: {
                    [field]: (0, ai_secrets_1.encryptAiSecret)(trimmedKey),
                    provider,
                },
                $setOnInsert: { user_id },
            }, { upsert: true, new: true, setDefaultsOnInsert: true }).exec();
            yield this.invalidateUserAiCaches(user_id);
            return this.getSettings(user_id);
        });
    }
    removeProviderKey(user_id, provider) {
        return __awaiter(this, void 0, void 0, function* () {
            if (provider !== 'gemini' && provider !== 'claude') {
                throw new models_1.ClientError(400, 'Unsupported API-key provider.');
            }
            const field = provider === 'gemini' ? 'geminiApiKey' : 'claudeApiKey';
            const doc = yield this.ensureDocument(user_id);
            doc.set(field, undefined);
            const providers = this.buildProviderStatuses(doc);
            doc.provider = this.getEffectiveProvider(doc.provider, providers);
            yield doc.save();
            yield this.invalidateUserAiCaches(user_id);
            return this.getSettings(user_id);
        });
    }
    resolveProvider(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            const doc = yield UserAiSettings_1.UserAiSettings.findOne({ user_id }).exec();
            const providers = this.buildProviderStatuses(doc);
            const provider = this.getEffectiveProvider(doc === null || doc === void 0 ? void 0 : doc.provider, providers);
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
                ? (0, ai_secrets_1.decryptAiSecret)(doc === null || doc === void 0 ? void 0 : doc.geminiApiKey)
                : (0, ai_secrets_1.decryptAiSecret)(doc === null || doc === void 0 ? void 0 : doc.claudeApiKey);
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
        });
    }
}
const aiSettingsLogic = new AiSettingsLogic();
exports.default = aiSettingsLogic;
