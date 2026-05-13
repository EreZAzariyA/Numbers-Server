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
exports.generateGeminiInsight = void 0;
const generative_ai_1 = require("@google/generative-ai");
const openai_1 = __importDefault(require("openai"));
const DEFAULT_MODEL = 'gemini-2.5-flash';
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const DAILY_QUOTA_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const SUPPRESSION_LOG_INTERVAL_MS = 5 * 60 * 1000;
const blockedUntilByModel = new Map();
const lastSuppressionLogByModel = new Map();
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
const logSuppressed = (model, context, blockedUntil) => {
    var _a;
    const now = Date.now();
    const lastLoggedAt = (_a = lastSuppressionLogByModel.get(model)) !== null && _a !== void 0 ? _a : 0;
    if (now - lastLoggedAt < SUPPRESSION_LOG_INTERVAL_MS)
        return;
    lastSuppressionLogByModel.set(model, now);
    console.warn(`Skipping Gemini insight (${context}) while ${model} is rate-limited until ${new Date(blockedUntil).toISOString()}`);
};
// ─── Ollama one-shot insight ─────────────────────────────────────────────────
const generateOllamaInsight = (_a) => __awaiter(void 0, [_a], void 0, function* ({ context, prompt, systemInstruction, maxOutputTokens, }) {
    var _b, _c;
    try {
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
    }
    catch (err) {
        console.error(`Ollama insight error (${context}):`, getErrorMessage(err));
        return '';
    }
});
// ─── Main export — routes to Ollama in dev, Gemini in prod ──────────────────
const generateGeminiInsight = (_a) => __awaiter(void 0, [_a], void 0, function* ({ apiKey, context, prompt, systemInstruction, maxOutputTokens, model = DEFAULT_MODEL, }) {
    // Use Ollama when OLLAMA_MODEL is set (works in dev and containerised deployments)
    if (process.env.OLLAMA_MODEL) {
        return generateOllamaInsight({ context, prompt, systemInstruction, maxOutputTokens });
    }
    if (!apiKey)
        return '';
    const blockedUntil = blockedUntilByModel.get(model);
    if (blockedUntil && blockedUntil > Date.now()) {
        logSuppressed(model, context, blockedUntil);
        return '';
    }
    try {
        const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
        const generativeModel = genAI.getGenerativeModel({
            model,
            generationConfig: { maxOutputTokens },
            systemInstruction,
        });
        const result = yield generativeModel.generateContent(prompt);
        blockedUntilByModel.delete(model);
        return result.response.text().trim();
    }
    catch (err) {
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
});
exports.generateGeminiInsight = generateGeminiInsight;
