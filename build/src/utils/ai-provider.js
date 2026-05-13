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
exports.generateUserInsight = exports.getAiRateLimitMessage = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const generative_ai_1 = require("@google/generative-ai");
const openai_1 = __importDefault(require("openai"));
const ai_settings_1 = __importDefault(require("../bll/ai-settings"));
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const DAILY_QUOTA_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const SUPPRESSION_LOG_INTERVAL_MS = 5 * 60 * 1000;
const blockedUntilByKey = new Map();
const lastSuppressionLogByKey = new Map();
const getErrorMessage = (err) => {
    if (err instanceof Error)
        return err.message;
    if (typeof err === 'string')
        return err;
    return String(err !== null && err !== void 0 ? err : '');
};
const isRateLimited = (message) => /429|too many requests|rate limit/i.test(message);
const isDailyQuotaExceeded = (message) => /perday|per day|free[_ -]?tier|quota exceeded/i.test(message);
const getCooldownMs = (message) => isDailyQuotaExceeded(message) ? DAILY_QUOTA_COOLDOWN_MS : RATE_LIMIT_COOLDOWN_MS;
const sanitizeProviderErrorMessage = (message) => message
    .replace(/^error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
const getAiRateLimitMessage = (err, language) => {
    const rawMessage = sanitizeProviderErrorMessage(getErrorMessage(err));
    if (!rawMessage)
        return null;
    if (!isRateLimited(rawMessage) && !isDailyQuotaExceeded(rawMessage))
        return null;
    if (isDailyQuotaExceeded(rawMessage)) {
        return language === 'he'
            ? `חרגת ממכסת השימוש היומית של ספק ה-AI: ${rawMessage}`
            : `The AI provider daily quota was reached: ${rawMessage}`;
    }
    return language === 'he'
        ? `הגעת למגבלת הקצב של ספק ה-AI: ${rawMessage}`
        : `The AI provider rate limit was reached: ${rawMessage}`;
};
exports.getAiRateLimitMessage = getAiRateLimitMessage;
const logSuppressed = (key, context, blockedUntil) => {
    var _a;
    const now = Date.now();
    const lastLoggedAt = (_a = lastSuppressionLogByKey.get(key)) !== null && _a !== void 0 ? _a : 0;
    if (now - lastLoggedAt < SUPPRESSION_LOG_INTERVAL_MS)
        return;
    lastSuppressionLogByKey.set(key, now);
    console.warn(`Skipping AI insight (${context}) while ${key} is rate-limited until ${new Date(blockedUntil).toISOString()}`);
};
const generateOllamaInsight = (_a) => __awaiter(void 0, [_a], void 0, function* ({ prompt, systemInstruction, maxOutputTokens, }) {
    var _b, _c;
    const client = new openai_1.default({
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
        apiKey: 'ollama',
    });
    const response = yield client.chat.completions.create({
        model: process.env.OLLAMA_MODEL,
        messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: prompt },
        ],
        max_tokens: maxOutputTokens,
    });
    return (_c = (_b = response.choices[0].message.content) === null || _b === void 0 ? void 0 : _b.trim()) !== null && _c !== void 0 ? _c : '';
});
const generateGeminiInsight = (_a) => __awaiter(void 0, [_a], void 0, function* ({ apiKey, prompt, systemInstruction, maxOutputTokens, model, }) {
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    const generativeModel = genAI.getGenerativeModel({
        model,
        generationConfig: { maxOutputTokens },
        systemInstruction,
    });
    const result = yield generativeModel.generateContent(prompt);
    return result.response.text().trim();
});
const generateClaudeInsight = (_a) => __awaiter(void 0, [_a], void 0, function* ({ apiKey, prompt, systemInstruction, maxOutputTokens, model, }) {
    const client = new sdk_1.default({ apiKey });
    const response = yield client.messages.create({
        model,
        max_tokens: maxOutputTokens,
        system: systemInstruction,
        messages: [{ role: 'user', content: prompt }],
    });
    return response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
});
const generateUserInsight = (_a) => __awaiter(void 0, [_a], void 0, function* ({ user_id, context, prompt, systemInstruction, maxOutputTokens, }) {
    const runtime = yield ai_settings_1.default.resolveProvider(user_id);
    if (!runtime.available || !runtime.model)
        return '';
    const suppressionKey = `${runtime.provider}:${runtime.model}`;
    const blockedUntil = blockedUntilByKey.get(suppressionKey);
    if (blockedUntil && blockedUntil > Date.now()) {
        logSuppressed(suppressionKey, context, blockedUntil);
        return '';
    }
    try {
        let response = '';
        if (runtime.provider === 'ollama') {
            response = yield generateOllamaInsight({ prompt, systemInstruction, maxOutputTokens });
        }
        else if (runtime.provider === 'gemini' && runtime.apiKey) {
            response = yield generateGeminiInsight({
                apiKey: runtime.apiKey,
                prompt,
                systemInstruction,
                maxOutputTokens,
                model: runtime.model,
            });
        }
        else if (runtime.provider === 'claude' && runtime.apiKey) {
            response = yield generateClaudeInsight({
                apiKey: runtime.apiKey,
                prompt,
                systemInstruction,
                maxOutputTokens,
                model: runtime.model,
            });
        }
        blockedUntilByKey.delete(suppressionKey);
        return response;
    }
    catch (err) {
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
});
exports.generateUserInsight = generateUserInsight;
