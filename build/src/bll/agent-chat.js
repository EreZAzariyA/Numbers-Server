"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const generative_ai_1 = require("@google/generative-ai");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const openai_1 = __importDefault(require("openai"));
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const collections_1 = require("../collections");
const banks_1 = __importDefault(require("./banks"));
const cash_flow_projection_1 = require("./cash-flow-projection");
const categories_1 = __importDefault(require("./categories"));
const financial_health_1 = require("./financial-health");
const forecast_1 = require("./forecast");
const normalization_1 = require("./recurring/normalization");
const pattern_service_1 = require("./recurring/pattern-service");
const savings_goals_1 = __importDefault(require("./savings-goals"));
const transactions_2 = __importStar(require("./transactions"));
const models_1 = require("../models");
const socket_1 = require("../dal/socket");
const settlement_detection_1 = require("../utils/settlement-detection");
const transaction_semantics_1 = require("../utils/transaction-semantics");
const ai_provider_1 = require("../utils/ai-provider");
const ai_settings_1 = __importDefault(require("./ai-settings"));
const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 5;
const PENDING_ACTION_TTL_MS = 1000 * 60 * 10;
const TRANSACTION_SOURCE_ENUM = ['account-transactions', 'card-transactions', 'transactions', 'creditCards'];
const TRANSACTION_FILTER_ENUM = ['all', ...TRANSACTION_SOURCE_ENUM];
const TRANSACTION_TYPE_ALIASES = {
    all: 'all',
    transactions: 'transactions',
    transaction: 'transactions',
    'account-transactions': 'transactions',
    'account-transaction': 'transactions',
    account: 'transactions',
    accounts: 'transactions',
    'bank-transactions': 'transactions',
    'bank-transaction': 'transactions',
    bank: 'transactions',
    banks: 'transactions',
    creditcards: 'creditCards',
    'credit-cards': 'creditCards',
    'credit-card': 'creditCards',
    'credit-card-transactions': 'creditCards',
    'credit-card-transaction': 'creditCards',
    'card-transactions': 'creditCards',
    'card-transaction': 'creditCards',
    card: 'creditCards',
    cards: 'creditCards',
};
const roundAmount = (value) => Math.round((value || 0) * 100) / 100;
const startOfMonth = (year, month) => `${year}-${String(month).padStart(2, '0')}-01`;
const endOfMonth = (year, month) => {
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};
const addOneDay = (date) => {
    const next = new Date(`${date}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
};
const buildInclusiveDateRangeFilter = (start, end) => ({
    $gte: start,
    $lt: addOneDay(end),
});
const addMonths = (year, month, delta) => {
    const current = new Date(year, month - 1 + delta, 1);
    return { year: current.getFullYear(), month: current.getMonth() + 1 };
};
const formatDateWindow = (start, end) => `${start.slice(0, 10)} to ${end.slice(0, 10)}`;
const localize = (language, en, he) => language === 'he' ? he : en;
const toProgressStepId = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
class AgentChatLogic {
    loadHistory(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const [doc, pendingAction] = yield Promise.all([
                collections_1.ChatHistory.findOne({ user_id }).lean().exec(),
                this.loadLatestPendingAction(user_id),
            ]);
            return {
                messages: (_b = (_a = doc === null || doc === void 0 ? void 0 : doc.messages) === null || _a === void 0 ? void 0 : _a.map((message) => ({ role: message.role, content: message.content }))) !== null && _b !== void 0 ? _b : [],
                pendingAction,
            };
        });
    }
    saveHistory(user_id, messages) {
        return __awaiter(this, void 0, void 0, function* () {
            const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
            const docs = trimmed.map((message) => ({
                role: message.role,
                content: message.content,
                timestamp: new Date(),
            }));
            yield collections_1.ChatHistory.findOneAndUpdate({ user_id }, { $set: { messages: docs } }, { upsert: true, new: true }).exec();
        });
    }
    appendAssistantMessage(user_id, content) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(content === null || content === void 0 ? void 0 : content.trim()))
                return;
            const history = (yield this.loadHistory(user_id)).messages;
            yield this.saveHistory(user_id, [...history, { role: 'assistant', content }]);
        });
    }
    clearHistory(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            yield Promise.all([
                collections_1.ChatHistory.deleteOne({ user_id }).exec(),
                this.cancelAllPendingActions(user_id),
            ]);
        });
    }
    chat(user_id, message, language, requestId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(message === null || message === void 0 ? void 0 : message.trim()))
                return { reply: '' };
            const normalizedLanguage = this.normalizeLanguage(language);
            const emitProgress = this.createProgressEmitter(user_id, normalizedLanguage, requestId);
            emitProgress('reviewing-request');
            const runtime = yield ai_settings_1.default.resolveProvider(user_id);
            if (!runtime.available || !runtime.model) {
                emitProgress('completed', undefined, 'complete');
                return {
                    reply: localize(normalizedLanguage, 'The selected AI provider is not configured. Open Settings > API Keys to finish setup.', 'ספק ה-AI שנבחר עדיין לא מוגדר. פתח את הגדרות > מפתחות API כדי להשלים את ההגדרה.'),
                };
            }
            const today = new Date().toISOString().slice(0, 10);
            const history = (yield this.loadHistory(user_id)).messages;
            const updatedHistory = [...history, { role: 'user', content: message }];
            emitProgress('loading-finance-context');
            const contextBlock = yield this.buildContextBlock(user_id, normalizedLanguage);
            const stagedActionRef = { value: null };
            const createToolUsageRef = () => ({
                names: [],
                usedAnyTool: false,
                usedReadTool: false,
            });
            const shouldRequireGroundedData = this.shouldRequireGroundedData(message);
            const systemInstruction = `You are a personal finance assistant for an Israeli finance app.
Always respond in ${normalizedLanguage === 'he' ? 'Hebrew' : 'English'}.
Use the provided tools to look up real finance data before answering.
Mutation tools never execute immediately. When you call a mutation tool, the server will stage the action and require UI confirmation.
When a tool says confirmation is required:
- Explain what was prepared
- Tell the user to use the confirmation controls in the chat UI
- Do not ask the user to type "yes"
- Do not stage more than one action in the same answer
When the user says account-transactions, account transactions, or bank transactions, they mean the bank/account ledger ("transactions").
When the user says card-transactions, card transactions, or credit-card transactions, they mean the credit-card ledger ("creditCards").
Prefer the explicit transaction source argument when a transaction tool supports it.
Format your responses in Markdown:
- Use **bold** for amounts, merchant names, and key figures
- Use tables when comparing multiple items. Output raw GFM tables and never wrap them in code fences
- Use bullet lists for multiple items
- Keep responses concise
Use ₪ for amounts. Today's date is ${today}.${contextBlock}`;
            const strictSystemInstruction = `${systemInstruction}
For the user's latest request, you must call at least one relevant read tool before answering.
If you cannot verify the answer from a tool result, say that you could not verify it from live finance data and do not guess.`;
            try {
                emitProgress('consulting-assistant');
                let toolUsageRef = createToolUsageRef();
                let reply = runtime.provider === 'ollama'
                    ? yield this.chatWithOllama(systemInstruction, updatedHistory, user_id, normalizedLanguage, stagedActionRef, runtime.model, toolUsageRef, emitProgress)
                    : runtime.provider === 'claude'
                        ? yield this.chatWithClaude(systemInstruction, updatedHistory, user_id, normalizedLanguage, stagedActionRef, runtime, toolUsageRef, emitProgress)
                        : yield this.chatWithGemini(systemInstruction, updatedHistory, user_id, normalizedLanguage, stagedActionRef, runtime, toolUsageRef, emitProgress);
                if (shouldRequireGroundedData && !toolUsageRef.usedAnyTool) {
                    emitProgress('consulting-assistant');
                    toolUsageRef = createToolUsageRef();
                    reply = runtime.provider === 'ollama'
                        ? yield this.chatWithOllama(strictSystemInstruction, updatedHistory, user_id, normalizedLanguage, stagedActionRef, runtime.model, toolUsageRef, emitProgress, true)
                        : runtime.provider === 'claude'
                            ? yield this.chatWithClaude(strictSystemInstruction, updatedHistory, user_id, normalizedLanguage, stagedActionRef, runtime, toolUsageRef, emitProgress)
                            : yield this.chatWithGemini(strictSystemInstruction, updatedHistory, user_id, normalizedLanguage, stagedActionRef, runtime, toolUsageRef, emitProgress);
                }
                if (shouldRequireGroundedData && !toolUsageRef.usedAnyTool) {
                    emitProgress('assistant-error', undefined, 'error');
                    return {
                        reply: localize(normalizedLanguage, 'I could not verify that from live finance data, so I do not want to guess. Please try again.', 'לא הצלחתי לאמת את זה מנתוני הכספים החיים, ולכן אני לא רוצה לנחש. נסה שוב.'),
                    };
                }
                emitProgress('finalizing-response');
                yield this.saveHistory(user_id, [...updatedHistory, { role: 'assistant', content: reply }]);
                emitProgress('completed', undefined, 'complete');
                return { reply, pendingAction: stagedActionRef.value };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err !== null && err !== void 0 ? err : '');
                const rateLimitReply = (0, ai_provider_1.getAiRateLimitMessage)(err, normalizedLanguage);
                if (rateLimitReply) {
                    emitProgress('assistant-error', undefined, 'error');
                    console.warn('Agent chat rate limit:', msg);
                    return { reply: rateLimitReply };
                }
                if (/503|service unavailable|high demand|try again/i.test(msg)) {
                    emitProgress('assistant-error', undefined, 'error');
                    return {
                        reply: normalizedLanguage === 'he'
                            ? 'העוזר עמוס כרגע. אנא נסה שוב בעוד מספר שניות.'
                            : 'The assistant is busy right now. Please try again in a few seconds.',
                    };
                }
                console.error('Agent chat error:', msg);
                emitProgress('assistant-error', undefined, 'error');
                return {
                    reply: normalizedLanguage === 'he'
                        ? 'אירעה שגיאה. אנא נסה שוב.'
                        : 'Something went wrong. Please try again.',
                };
            }
        });
    }
    confirmPendingAction(user_id, actionId, language) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const normalizedLanguage = this.normalizeLanguage(language);
            const action = yield this.loadPendingActionOrThrow(user_id, actionId);
            const definition = this.getToolDefinition(action.tool);
            if (!definition || definition.mode !== 'mutate') {
                throw new models_1.ClientError(400, 'Pending action is not executable.');
            }
            const now = new Date();
            if (action.status !== 'pending') {
                throw new models_1.ClientError(409, this.buildInactiveActionMessage(action.status, normalizedLanguage));
            }
            if (action.expiresAt.getTime() <= now.getTime()) {
                yield collections_1.AgentPendingActions.findByIdAndUpdate(action._id, {
                    $set: { status: 'expired', expiredAt: now },
                }).exec();
                throw new models_1.ClientError(409, this.buildInactiveActionMessage('expired', normalizedLanguage));
            }
            const result = yield definition.execute((_a = action.args) !== null && _a !== void 0 ? _a : {}, {
                user_id,
                language: normalizedLanguage,
                stageMutations: false,
                stagedActionRef: { value: null },
            });
            yield collections_1.AgentPendingActions.findByIdAndUpdate(action._id, {
                $set: { status: 'confirmed', confirmedAt: now, result },
            }).exec();
            const reply = definition.buildResultReply
                ? definition.buildResultReply((_b = action.args) !== null && _b !== void 0 ? _b : {}, result, normalizedLanguage)
                : localize(normalizedLanguage, 'The action was completed successfully.', 'הפעולה הושלמה בהצלחה.');
            yield this.appendAssistantMessage(user_id, reply);
            return { reply };
        });
    }
    cancelPendingAction(user_id, actionId, language) {
        return __awaiter(this, void 0, void 0, function* () {
            const normalizedLanguage = this.normalizeLanguage(language);
            const action = yield this.loadPendingActionOrThrow(user_id, actionId);
            if (action.status !== 'pending') {
                throw new models_1.ClientError(409, this.buildInactiveActionMessage(action.status, normalizedLanguage));
            }
            yield collections_1.AgentPendingActions.findByIdAndUpdate(action._id, {
                $set: { status: 'cancelled', cancelledAt: new Date() },
            }).exec();
            const reply = localize(normalizedLanguage, `Cancelled the pending action for **${action.summary}**.`, `ביטלתי את הפעולה הממתינה עבור **${action.summary}**.`);
            yield this.appendAssistantMessage(user_id, reply);
            return { reply };
        });
    }
    normalizeLanguage(language) {
        return language === 'he' ? 'he' : 'en';
    }
    createProgressEmitter(user_id, language, requestId) {
        if (!requestId) {
            return () => undefined;
        }
        return (step, toolName, status = 'active') => {
            const payload = {
                requestId,
                step,
                label: this.buildProgressLabel(language, step, toolName),
                status,
                at: new Date().toISOString(),
                tool: toolName,
            };
            socket_1.socketIo.emitToUser(user_id, 'agent:progress', payload);
        };
    }
    buildProgressLabel(language, step, toolName) {
        switch (step) {
            case 'reviewing-request':
                return localize(language, 'Reviewing your request', 'בודק את הבקשה שלך');
            case 'loading-finance-context':
                return localize(language, 'Loading your finance context', 'טוען את ההקשר הפיננסי שלך');
            case 'consulting-assistant':
                return localize(language, 'Consulting the finance assistant', 'מתייעץ עם העוזר הפיננסי');
            case 'finalizing-response':
                return localize(language, 'Drafting the reply', 'מנסח את התשובה');
            case 'staging-action':
                return localize(language, 'Preparing an action for confirmation', 'מכין פעולה לאישור');
            case 'completed':
                return localize(language, 'Response ready', 'התשובה מוכנה');
            case 'assistant-error':
                return localize(language, 'The assistant hit an error', 'העוזר נתקל בשגיאה');
            default:
                if (step.startsWith('tool:')) {
                    const label = this.formatToolDisplayName(toolName || step.slice(5));
                    return localize(language, `Checking ${label}`, `בודק את ${label}`);
                }
                return localize(language, 'Working on your request', 'עובד על הבקשה שלך');
        }
    }
    shouldRequireGroundedData(message) {
        const normalizedMessage = message.trim().toLowerCase();
        if (!normalizedMessage)
            return false;
        const retrievalIntent = /\b(list|show|what|which|when|find|search|compare|total|how much|give me|tell me)\b/i;
        const financeDataTopic = /\b(transaction|transactions|spent|spend|expense|expenses|income|merchant|merchants|date|dates|balance|balances|category|categories|card|cards|bank|banks|payment|payments|wolt)\b/i;
        return retrievalIntent.test(normalizedMessage) && financeDataTopic.test(normalizedMessage);
    }
    formatToolDisplayName(name) {
        if (!name)
            return 'finance data';
        return String(name)
            .replace(/[_-]+/g, ' ')
            .trim()
            .toLowerCase();
    }
    normalizeTransactionType(type) {
        var _a;
        const normalizedType = String(type !== null && type !== void 0 ? type : '')
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, '-');
        if (!normalizedType)
            return 'all';
        return (_a = TRANSACTION_TYPE_ALIASES[normalizedType]) !== null && _a !== void 0 ? _a : 'all';
    }
    getTransactionLabel(type) {
        return type === 'creditCards' ? 'card-transactions' : 'account-transactions';
    }
    chatWithGemini(systemInstruction, messages, user_id, language, stagedActionRef, runtime, toolUsageRef, emitProgress) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const genAI = new generative_ai_1.GoogleGenerativeAI(runtime.apiKey);
            const model = genAI.getGenerativeModel({
                model: runtime.model,
                systemInstruction,
                tools: [{ functionDeclarations: this.getGeminiTools() }],
            });
            const history = messages.slice(0, -1).map((message) => ({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: message.content }],
            }));
            const chat = model.startChat({ history });
            const lastMessage = messages[messages.length - 1].content;
            let result = yield chat.sendMessage(lastMessage);
            for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
                const parts = (_d = (_c = (_b = (_a = result.response.candidates) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) !== null && _d !== void 0 ? _d : [];
                const functionCallPart = parts.find((part) => part.functionCall);
                if (!(functionCallPart === null || functionCallPart === void 0 ? void 0 : functionCallPart.functionCall))
                    break;
                const { name, args } = functionCallPart.functionCall;
                const toolResult = yield this.executeTool(name, (args !== null && args !== void 0 ? args : {}), {
                    user_id,
                    language,
                    stageMutations: true,
                    stagedActionRef,
                    toolUsageRef,
                    emitProgress,
                });
                emitProgress === null || emitProgress === void 0 ? void 0 : emitProgress('consulting-assistant');
                result = yield chat.sendMessage([{
                        functionResponse: {
                            name,
                            response: { result: JSON.stringify(toolResult) },
                        },
                    }]);
            }
            return result.response.text();
        });
    }
    chatWithOllama(systemInstruction_1, messages_1, user_id_1, language_1, stagedActionRef_1, model_1, toolUsageRef_1, emitProgress_1) {
        return __awaiter(this, arguments, void 0, function* (systemInstruction, messages, user_id, language, stagedActionRef, model, toolUsageRef, emitProgress, forceToolUse = false) {
            var _a, _b;
            const client = new openai_1.default({
                baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
                apiKey: 'ollama',
            });
            const history = [
                { role: 'system', content: systemInstruction },
                ...messages.map((message) => ({
                    role: (message.role === 'assistant' ? 'assistant' : 'user'),
                    content: message.content,
                })),
            ];
            let response = yield client.chat.completions.create(Object.assign({ model, messages: history, tools: this.getOpenAITools() }, (forceToolUse ? { tool_choice: 'required' } : {})));
            for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
                const choice = response.choices[0];
                if (choice.finish_reason !== 'tool_calls' || !((_a = choice.message.tool_calls) === null || _a === void 0 ? void 0 : _a.length))
                    break;
                history.push(choice.message);
                for (const call of choice.message.tool_calls) {
                    if (call.type !== 'function')
                        continue;
                    const parsedArguments = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                    const result = yield this.executeTool(call.function.name, parsedArguments, {
                        user_id,
                        language,
                        stageMutations: true,
                        stagedActionRef,
                        toolUsageRef,
                        emitProgress,
                    });
                    history.push({
                        role: 'tool',
                        tool_call_id: call.id,
                        content: JSON.stringify(result),
                    });
                }
                emitProgress === null || emitProgress === void 0 ? void 0 : emitProgress('consulting-assistant');
                response = yield client.chat.completions.create(Object.assign({ model, messages: history, tools: this.getOpenAITools() }, (forceToolUse ? { tool_choice: 'required' } : {})));
            }
            return (_b = response.choices[0].message.content) !== null && _b !== void 0 ? _b : '';
        });
    }
    chatWithClaude(systemInstruction, messages, user_id, language, stagedActionRef, runtime, toolUsageRef, emitProgress) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const client = new sdk_1.default({ apiKey: runtime.apiKey });
            const history = messages.map((message) => ({
                role: message.role,
                content: message.content,
            }));
            let response = yield client.messages.create({
                model: runtime.model,
                max_tokens: 1200,
                system: systemInstruction,
                messages: history,
                tools: this.getAnthropicTools(),
            });
            for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
                const toolUses = response.content.filter((block) => block.type === 'tool_use');
                if (!toolUses.length)
                    break;
                history.push({
                    role: 'assistant',
                    content: response.content,
                });
                const toolResults = [];
                for (const toolUse of toolUses) {
                    const result = yield this.executeTool(toolUse.name, ((_a = toolUse.input) !== null && _a !== void 0 ? _a : {}), {
                        user_id,
                        language,
                        stageMutations: true,
                        stagedActionRef,
                        toolUsageRef,
                        emitProgress,
                    });
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: JSON.stringify(result),
                    });
                }
                history.push({
                    role: 'user',
                    content: toolResults,
                });
                emitProgress === null || emitProgress === void 0 ? void 0 : emitProgress('consulting-assistant');
                response = yield client.messages.create({
                    model: runtime.model,
                    max_tokens: 1200,
                    system: systemInstruction,
                    messages: history,
                    tools: this.getAnthropicTools(),
                });
            }
            return response.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('\n')
                .trim();
        });
    }
    getToolDefinition(name) {
        return this.getToolDefinitions().find((definition) => definition.name === name);
    }
    getGeminiTools() {
        return this.getToolDefinitions().map((definition) => ({
            name: definition.name,
            description: definition.description,
            parameters: this.toGeminiSchema(definition.schema),
        }));
    }
    getOpenAITools() {
        return this.getToolDefinitions().map((definition) => ({
            type: 'function',
            function: {
                name: definition.name,
                description: definition.description,
                parameters: this.toOpenAISchema(definition.schema),
            },
        }));
    }
    getAnthropicTools() {
        return this.getToolDefinitions().map((definition) => ({
            name: definition.name,
            description: definition.description,
            input_schema: this.toOpenAISchema(definition.schema),
        }));
    }
    toOpenAISchema(schema) {
        var _a;
        const convertProperty = (property) => {
            var _a, _b;
            const result = { type: property.type };
            if (property.description)
                result.description = property.description;
            if (property.enum)
                result.enum = property.enum;
            if (property.type === 'object') {
                result.properties = Object.fromEntries(Object.entries((_a = property.properties) !== null && _a !== void 0 ? _a : {}).map(([key, value]) => [key, convertProperty(value)]));
                result.required = (_b = property.required) !== null && _b !== void 0 ? _b : [];
            }
            if (property.type === 'array' && property.items) {
                result.items = convertProperty(property.items);
            }
            return result;
        };
        return {
            type: 'object',
            properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, convertProperty(value)])),
            required: (_a = schema.required) !== null && _a !== void 0 ? _a : [],
        };
    }
    toGeminiSchema(schema) {
        const mapType = (type) => {
            switch (type) {
                case 'string': return generative_ai_1.SchemaType.STRING;
                case 'number': return generative_ai_1.SchemaType.NUMBER;
                case 'boolean': return generative_ai_1.SchemaType.BOOLEAN;
                case 'array': return generative_ai_1.SchemaType.ARRAY;
                default: return generative_ai_1.SchemaType.OBJECT;
            }
        };
        const convertProperty = (property) => {
            var _a, _b;
            const result = { type: mapType(property.type) };
            if (property.description)
                result.description = property.description;
            if (property.enum)
                result.enum = property.enum;
            if (property.type === 'object') {
                result.properties = Object.fromEntries(Object.entries((_a = property.properties) !== null && _a !== void 0 ? _a : {}).map(([key, value]) => [key, convertProperty(value)]));
                result.required = (_b = property.required) !== null && _b !== void 0 ? _b : [];
            }
            if (property.type === 'array' && property.items) {
                result.items = convertProperty(property.items);
            }
            return result;
        };
        return convertProperty(schema);
    }
    executeTool(name, args, context) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const definition = this.getToolDefinition(name);
            if (!definition) {
                return { error: `Unknown tool: ${name}` };
            }
            if (context.toolUsageRef) {
                context.toolUsageRef.usedAnyTool = true;
                if (definition.mode === 'read') {
                    context.toolUsageRef.usedReadTool = true;
                }
                context.toolUsageRef.names.push(definition.name);
            }
            (_a = context.emitProgress) === null || _a === void 0 ? void 0 : _a.call(context, `tool:${toProgressStepId(definition.name)}`, definition.name);
            if (definition.mode === 'mutate' && context.stageMutations) {
                return this.stagePendingAction(definition, args, context);
            }
            return definition.execute(args, context);
        });
    }
    stagePendingAction(definition, args, context) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (context.stagedActionRef.value) {
                return {
                    error: 'An action is already waiting for confirmation. Ask the user to confirm or cancel it first.',
                };
            }
            yield this.expireStalePendingActions(context.user_id);
            yield this.cancelAllPendingActions(context.user_id);
            const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS);
            const preview = definition.argsPreview ? definition.argsPreview(args) : this.buildDefaultArgsPreview(args);
            const doc = yield collections_1.AgentPendingActions.create({
                user_id: context.user_id,
                tool: definition.name,
                summary: definition.summarize(args),
                args,
                argsPreview: preview,
                status: 'pending',
                expiresAt,
            });
            const pendingAction = this.toPendingActionView(doc);
            context.stagedActionRef.value = pendingAction;
            (_a = context.emitProgress) === null || _a === void 0 ? void 0 : _a.call(context, 'staging-action', definition.name);
            return {
                requires_confirmation: true,
                pending_action: pendingAction,
                message: 'The action has been staged and now requires confirmation in the chat UI.',
            };
        });
    }
    loadLatestPendingAction(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.expireStalePendingActions(user_id);
            const doc = yield collections_1.AgentPendingActions.findOne({ user_id, status: 'pending' })
                .sort({ createdAt: -1 })
                .exec();
            return doc ? this.toPendingActionView(doc) : null;
        });
    }
    loadPendingActionOrThrow(user_id, actionId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.expireStalePendingActions(user_id);
            const action = yield collections_1.AgentPendingActions.findOne({ _id: actionId, user_id }).exec();
            if (!action) {
                throw new models_1.ClientError(404, 'Pending action not found.');
            }
            return action;
        });
    }
    expireStalePendingActions(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            const now = new Date();
            const query = {
                status: 'pending',
                expiresAt: { $lte: now },
            };
            if (user_id)
                query.user_id = user_id;
            yield collections_1.AgentPendingActions.updateMany(query, {
                $set: { status: 'expired', expiredAt: now },
            }).exec();
        });
    }
    cancelAllPendingActions(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            yield collections_1.AgentPendingActions.updateMany({ user_id, status: 'pending' }, {
                $set: { status: 'cancelled', cancelledAt: new Date() },
            }).exec();
        });
    }
    toPendingActionView(action) {
        var _a;
        return {
            id: action._id.toString(),
            tool: action.tool,
            summary: action.summary,
            argsPreview: (_a = action.argsPreview) !== null && _a !== void 0 ? _a : {},
            expiresAt: action.expiresAt.toISOString(),
        };
    }
    buildDefaultArgsPreview(args) {
        return Object.fromEntries(Object.entries(args).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.slice(0, 5) : value,
        ]));
    }
    buildInactiveActionMessage(status, language) {
        switch (status) {
            case 'confirmed':
                return localize(language, 'That action was already confirmed.', 'הפעולה הזו כבר אושרה.');
            case 'cancelled':
                return localize(language, 'That action was already cancelled.', 'הפעולה הזו כבר בוטלה.');
            case 'expired':
            default:
                return localize(language, 'That action has expired. Please ask again.', 'הפעולה הזו פגה. בקש שוב.');
        }
    }
    buildContextBlock(user_id, language) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const [healthResult, forecastResult, goalsResult] = yield Promise.allSettled([
                (0, financial_health_1.calculateFinancialHealth)(user_id, language),
                (0, forecast_1.calculateForecast)(user_id, language),
                collections_1.SavingsGoals.findOne({ user_id }).lean().exec(),
            ]);
            const lines = ['--- FINANCIAL CONTEXT (pre-loaded, use as background knowledge) ---'];
            let hasAny = false;
            if (healthResult.status === 'fulfilled') {
                const health = healthResult.value;
                hasAny = true;
                lines.push(`Financial health: ${health.status} (score ${health.score}/100)`);
                lines.push(`  Cash flow: ${health.components.cashFlow.status} — ${health.components.cashFlow.detail}`);
                lines.push(`  Savings trend: ${health.components.savingsTrend.status} — ${health.components.savingsTrend.detail}`);
                lines.push(`  Category budgets: ${health.components.categoryBudgets.status} — ${health.components.categoryBudgets.detail}`);
                lines.push(`  Debt pressure: ${health.components.debtPressure.status} — ${health.components.debtPressure.detail}`);
            }
            if (forecastResult.status === 'fulfilled') {
                const forecast = forecastResult.value;
                hasAny = true;
                lines.push(`Month forecast: spent ₪${forecast.currentMonthSpend} so far, projected ₪${forecast.forecastAmount} by month-end ` +
                    `(avg ₪${forecast.averageMonthlySpend}/month, trend: ${forecast.trend}, ${forecast.daysRemaining} days remaining)`);
            }
            if (goalsResult.status === 'fulfilled' && ((_b = (_a = goalsResult.value) === null || _a === void 0 ? void 0 : _a.goals) === null || _b === void 0 ? void 0 : _b.length)) {
                hasAny = true;
                lines.push('Savings goals:');
                for (const goal of goalsResult.value.goals) {
                    const progress = goal.targetAmount > 0 ? Math.round((goal.currentAmount / goal.targetAmount) * 100) : 0;
                    const targetDate = goal.targetDate ? `, target date: ${goal.targetDate}` : '';
                    lines.push(`  - ${goal.name}: ₪${goal.currentAmount}/₪${goal.targetAmount} (${progress}%${targetDate})`);
                }
            }
            if (!hasAny)
                return '';
            lines.push('--- END FINANCIAL CONTEXT ---');
            return `\n\n${lines.join('\n')}`;
        });
    }
    getDateRange(month, year) {
        const now = new Date();
        const normalizedMonth = month !== null && month !== void 0 ? month : now.getMonth() + 1;
        const normalizedYear = year !== null && year !== void 0 ? year : now.getFullYear();
        return {
            start: startOfMonth(normalizedYear, normalizedMonth),
            end: endOfMonth(normalizedYear, normalizedMonth),
        };
    }
    getBankTransactionsInRange(user_id, start, end) {
        return __awaiter(this, void 0, void 0, function* () {
            return collections_1.Transactions.find({ user_id, eventDate: buildInclusiveDateRangeFilter(start, end) }).lean().exec();
        });
    }
    getCardTransactionsInRange(user_id, start, end) {
        return __awaiter(this, void 0, void 0, function* () {
            return collections_1.CardTransactions.find({ user_id, eventDate: buildInclusiveDateRangeFilter(start, end) }).lean().exec();
        });
    }
    getCompletedTransactionsInRange(user_id, start, end) {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.all([
                collections_1.Transactions.find({
                    user_id,
                    status: transactions_1.TransactionStatuses.Completed,
                    eventDate: buildInclusiveDateRangeFilter(start, end),
                }).lean().exec(),
                collections_1.CardTransactions.find({
                    user_id,
                    status: transactions_1.TransactionStatuses.Completed,
                    eventDate: buildInclusiveDateRangeFilter(start, end),
                }).lean().exec(),
            ]);
        });
    }
    getUnifiedExpenseEntries(user_id, start, end) {
        return __awaiter(this, void 0, void 0, function* () {
            const [regularTransactions, cardTransactions] = yield this.getCompletedTransactionsInRange(user_id, start, end);
            const hasCardData = cardTransactions.length > 0;
            const settlementTreatments = (0, settlement_detection_1.buildSettlementTreatmentMap)(regularTransactions, cardTransactions);
            return [...regularTransactions, ...cardTransactions]
                .map((transaction) => {
                var _a, _b, _c, _d;
                const amount = (0, transaction_semantics_1.getTransactionAmount)(transaction);
                const treatment = (_d = settlementTreatments.get((_c = (_b = (_a = transaction._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : '')) !== null && _d !== void 0 ? _d : (0, settlement_detection_1.classifySettlement)((0, transaction_semantics_1.getTransactionTextSource)(transaction), hasCardData);
                return { transaction, amount, treatment };
            })
                .filter(({ amount, treatment }) => amount < 0 && treatment !== 'exclude')
                .map(({ transaction, amount }) => {
                var _a, _b, _c, _d, _e;
                return ({
                    amount: Math.abs(amount),
                    category_id: (_c = (_b = (_a = transaction.category_id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : '',
                    categoryName: transaction.category || transaction.providerCategoryName || 'Uncategorized',
                    description: (_d = transaction.description) !== null && _d !== void 0 ? _d : '',
                    normalizedDescription: (0, normalization_1.normalize)((_e = transaction.description) !== null && _e !== void 0 ? _e : ''),
                    date: (0, transaction_semantics_1.getPostingDate)(transaction) || (0, transaction_semantics_1.getEventDate)(transaction),
                });
            });
        });
    }
    resolveCategory(user_id, options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const categoriesDoc = yield collections_1.Categories.findOne({ user_id }).exec();
            const categories = (_a = categoriesDoc === null || categoriesDoc === void 0 ? void 0 : categoriesDoc.categories) !== null && _a !== void 0 ? _a : [];
            if (options.category_id) {
                const found = categories.find((category) => category._id.toString() === options.category_id);
                if (found)
                    return found;
            }
            if (options.category_name) {
                const normalizedName = options.category_name.trim().toLowerCase();
                const found = categories.find((category) => { var _a; return ((_a = category.name) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase()) === normalizedName; });
                if (found)
                    return found;
            }
            throw new models_1.ClientError(404, 'Category not found.');
        });
    }
    resolveTransaction(user_id, transactionId, type) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!transactionId) {
                throw new models_1.ClientError(400, 'Transaction id is required.');
            }
            const normalizedType = this.normalizeTransactionType(type);
            if (normalizedType === 'transactions') {
                const transaction = yield collections_1.Transactions.findOne({ _id: transactionId, user_id }).exec();
                if (!transaction)
                    throw new models_1.ClientError(404, 'Transaction not found.');
                return { transaction: transaction, type: 'transactions' };
            }
            if (normalizedType === 'creditCards') {
                const transaction = yield collections_1.CardTransactions.findOne({ _id: transactionId, user_id }).exec();
                if (!transaction)
                    throw new models_1.ClientError(404, 'Transaction not found.');
                return { transaction: transaction, type: 'creditCards' };
            }
            const [bankTransaction, cardTransaction] = yield Promise.all([
                collections_1.Transactions.findOne({ _id: transactionId, user_id }).exec(),
                collections_1.CardTransactions.findOne({ _id: transactionId, user_id }).exec(),
            ]);
            if (bankTransaction)
                return { transaction: bankTransaction, type: 'transactions' };
            if (cardTransaction)
                return { transaction: cardTransaction, type: 'creditCards' };
            throw new models_1.ClientError(404, 'Transaction not found.');
        });
    }
    getSavingsGoalById(user_id, goalId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const doc = yield collections_1.SavingsGoals.findOne({ user_id, 'goals._id': goalId }).exec();
            const goal = (_a = doc === null || doc === void 0 ? void 0 : doc.goals) === null || _a === void 0 ? void 0 : _a.find((item) => item._id.toString() === goalId);
            if (!goal) {
                throw new models_1.ClientError(404, 'Savings goal not found.');
            }
            return goal;
        });
    }
    searchTransactionsForAgent(user_id, args) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            const transactionType = this.normalizeTransactionType(args.transaction_type);
            const direction = args.direction === 'income' || args.direction === 'expense'
                ? args.direction
                : 'all';
            const status = args.status === 'completed' || args.status === 'pending'
                ? args.status
                : 'all';
            const sortBy = args.sort_by === 'amount' ? 'amount' : 'date';
            const sortOrder = args.sort_order === 'asc' ? 'asc' : 'desc';
            const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
            const startDate = args.start_date || '1900-01-01';
            const endDate = args.end_date || '2999-12-31';
            const minAmount = args.min_amount !== undefined ? Math.abs(Number(args.min_amount) || 0) : null;
            const maxAmount = args.max_amount !== undefined ? Math.abs(Number(args.max_amount) || 0) : null;
            const category = args.category_id || args.category_name
                ? yield this.resolveCategory(user_id, {
                    category_id: args.category_id,
                    category_name: args.category_name,
                })
                : null;
            const query = {
                user_id,
                eventDate: buildInclusiveDateRangeFilter(startDate, endDate),
            };
            if (status !== 'all') {
                query.status = status;
            }
            if (category === null || category === void 0 ? void 0 : category._id) {
                query.category_id = category._id;
            }
            const [bankTransactions, cardTransactions] = yield Promise.all([
                transactionType === 'creditCards' ? Promise.resolve([]) : collections_1.Transactions.find(query).lean().exec(),
                transactionType === 'transactions' ? Promise.resolve([]) : collections_1.CardTransactions.find(query).lean().exec(),
            ]);
            const normalizedQuery = String(args.query_text || '').trim().toLowerCase();
            const normalizedMerchant = String(args.merchant_name || '').trim().toLowerCase();
            const normalizedCardLast4 = String(args.card_last4 || '').trim();
            const matchesText = (transaction) => {
                const haystack = [
                    transaction.description,
                    transaction.memo,
                    transaction.providerCategoryName,
                    transaction.counterparty,
                    transaction.category,
                    transaction.cardLast4,
                ].filter(Boolean).join(' ').toLowerCase();
                if (normalizedQuery && !haystack.includes(normalizedQuery))
                    return false;
                if (normalizedMerchant && !(transaction.description || '').toLowerCase().includes(normalizedMerchant))
                    return false;
                if (normalizedCardLast4 && String(transaction.cardLast4 || transaction.cardNumber || '').slice(-4) !== normalizedCardLast4)
                    return false;
                return true;
            };
            const matchesAmount = (transaction) => {
                const absoluteAmount = Math.abs(Number(transaction.amount) || 0);
                if (minAmount !== null && absoluteAmount < minAmount)
                    return false;
                if (maxAmount !== null && absoluteAmount > maxAmount)
                    return false;
                return true;
            };
            const matchesDirection = (transaction) => {
                if (direction === 'all')
                    return true;
                if (direction === 'income')
                    return Number(transaction.amount) > 0;
                return Number(transaction.amount) < 0;
            };
            const taggedTransactions = [
                ...bankTransactions.map((transaction) => ({ source: 'transactions', transaction })),
                ...cardTransactions.map((transaction) => ({ source: 'creditCards', transaction })),
            ];
            const transactions = taggedTransactions
                .filter(({ transaction }) => matchesDirection(transaction))
                .filter(({ transaction }) => matchesAmount(transaction))
                .filter(({ transaction }) => matchesText(transaction))
                .map(({ source, transaction }) => {
                var _a, _b, _c, _d, _e, _f, _g, _h;
                return ({
                    id: transaction._id.toString(),
                    type: source,
                    transaction_type: this.getTransactionLabel(source),
                    date: (0, transaction_semantics_1.getEventDate)(transaction) || null,
                    postingDate: (0, transaction_semantics_1.getPostingDate)(transaction) || null,
                    description: (_a = transaction.description) !== null && _a !== void 0 ? _a : '',
                    amount: roundAmount(Number(transaction.amount) || 0),
                    status: (_b = transaction.status) !== null && _b !== void 0 ? _b : '',
                    companyId: (_c = transaction.companyId) !== null && _c !== void 0 ? _c : null,
                    category_id: (_f = (_e = (_d = transaction.category_id) === null || _d === void 0 ? void 0 : _d.toString) === null || _e === void 0 ? void 0 : _e.call(_d)) !== null && _f !== void 0 ? _f : null,
                    category: transaction.category || transaction.providerCategoryName || null,
                    cardLast4: (_h = (_g = transaction.cardLast4) !== null && _g !== void 0 ? _g : transaction.cardNumber) !== null && _h !== void 0 ? _h : null,
                    counterparty: transaction.counterparty || null,
                });
            });
            transactions.sort((left, right) => {
                if (sortBy === 'amount') {
                    return sortOrder === 'asc'
                        ? Number(left.amount) - Number(right.amount)
                        : Number(right.amount) - Number(left.amount);
                }
                const leftDate = String(left.date || '');
                const rightDate = String(right.date || '');
                return sortOrder === 'asc'
                    ? leftDate.localeCompare(rightDate)
                    : rightDate.localeCompare(leftDate);
            });
            return {
                totalMatches: transactions.length,
                transactions: transactions.slice(0, limit),
                appliedFilters: {
                    transaction_type: transactionType === 'all' ? 'all' : this.getTransactionLabel(transactionType),
                    collection_type: transactionType === 'all' ? 'all' : transactionType,
                    direction,
                    status,
                    start_date: (_a = args.start_date) !== null && _a !== void 0 ? _a : null,
                    end_date: (_b = args.end_date) !== null && _b !== void 0 ? _b : null,
                    category_id: (_e = (_d = (_c = category === null || category === void 0 ? void 0 : category._id) === null || _c === void 0 ? void 0 : _c.toString) === null || _d === void 0 ? void 0 : _d.call(_c)) !== null && _e !== void 0 ? _e : null,
                    category_name: (_g = (_f = category === null || category === void 0 ? void 0 : category.name) !== null && _f !== void 0 ? _f : args.category_name) !== null && _g !== void 0 ? _g : null,
                    min_amount: minAmount,
                    max_amount: maxAmount,
                    sort_by: sortBy,
                    sort_order: sortOrder,
                },
            };
        });
    }
    getAccountOverviewForAgent(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const account = yield banks_1.default.fetchMainAccountResponse(user_id);
            const banks = (_a = account === null || account === void 0 ? void 0 : account.banks) !== null && _a !== void 0 ? _a : [];
            const latestConnection = banks.reduce((latest, bank) => Math.max(latest, (bank === null || bank === void 0 ? void 0 : bank.lastConnection) || 0), 0);
            const mainAccount = (_b = banks.find((bank) => bank.isMainAccount)) !== null && _b !== void 0 ? _b : null;
            const totalBalance = banks.reduce((sum, bank) => { var _a; return sum + (Number((_a = bank === null || bank === void 0 ? void 0 : bank.details) === null || _a === void 0 ? void 0 : _a.balance) || 0); }, 0);
            const totalSavings = banks.reduce((sum, bank) => { var _a; return sum + (Number((_a = bank === null || bank === void 0 ? void 0 : bank.savings) === null || _a === void 0 ? void 0 : _a.totalDepositsCurrentValue) || 0); }, 0);
            const totalLoanBalance = banks.reduce((sum, bank) => { var _a, _b; return sum + (Number((_b = (_a = bank === null || bank === void 0 ? void 0 : bank.loans) === null || _a === void 0 ? void 0 : _a.summary) === null || _b === void 0 ? void 0 : _b.totalBalance) || 0); }, 0);
            const currentMonthLoanPayments = banks.reduce((sum, bank) => { var _a, _b; return sum + (Number((_b = (_a = bank === null || bank === void 0 ? void 0 : bank.loans) === null || _a === void 0 ? void 0 : _a.summary) === null || _b === void 0 ? void 0 : _b.currentMonthTotalPayment) || 0); }, 0);
            return {
                connectedBanks: banks.length,
                cardProviders: banks.filter((bank) => bank.isCardProvider).length,
                savedCredentials: banks.filter((bank) => !!bank.credentials).length,
                totalBalance: roundAmount(totalBalance),
                totalSavings: roundAmount(totalSavings),
                totalLoanBalance: roundAmount(totalLoanBalance),
                currentMonthLoanPayments: roundAmount(currentMonthLoanPayments),
                latestConnection: latestConnection ? new Date(latestConnection).toISOString() : null,
                mainAccount: mainAccount ? {
                    id: (_e = (_d = (_c = mainAccount._id) === null || _c === void 0 ? void 0 : _c.toString) === null || _d === void 0 ? void 0 : _d.call(_c)) !== null && _e !== void 0 ? _e : null,
                    bankName: mainAccount.bankName,
                    balance: roundAmount(Number((_f = mainAccount === null || mainAccount === void 0 ? void 0 : mainAccount.details) === null || _f === void 0 ? void 0 : _f.balance) || 0),
                    accountNumber: (_h = (_g = mainAccount === null || mainAccount === void 0 ? void 0 : mainAccount.details) === null || _g === void 0 ? void 0 : _g.accountNumber) !== null && _h !== void 0 ? _h : null,
                    lastConnection: mainAccount.lastConnection ? new Date(mainAccount.lastConnection).toISOString() : null,
                    isCardProvider: mainAccount.isCardProvider,
                } : null,
                accounts: banks.map((bank) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return ({
                        id: (_c = (_b = (_a = bank._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : null,
                        bankName: bank.bankName,
                        isMainAccount: !!bank.isMainAccount,
                        isCardProvider: !!bank.isCardProvider,
                        balance: roundAmount(Number((_d = bank === null || bank === void 0 ? void 0 : bank.details) === null || _d === void 0 ? void 0 : _d.balance) || 0),
                        accountNumber: (_f = (_e = bank === null || bank === void 0 ? void 0 : bank.details) === null || _e === void 0 ? void 0 : _e.accountNumber) !== null && _f !== void 0 ? _f : null,
                        lastConnection: bank.lastConnection ? new Date(bank.lastConnection).toISOString() : null,
                        hasCredentials: !!bank.credentials,
                        cardsCount: (_j = (_h = (_g = bank.cardsPastOrFutureDebit) === null || _g === void 0 ? void 0 : _g.cardsBlock) === null || _h === void 0 ? void 0 : _h.length) !== null && _j !== void 0 ? _j : 0,
                    });
                }),
            };
        });
    }
    getCreditCardSnapshotForAgent(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const account = yield banks_1.default.fetchMainAccountResponse(user_id);
            const banks = (_a = account === null || account === void 0 ? void 0 : account.banks) !== null && _a !== void 0 ? _a : [];
            const cardProviders = banks.filter((bank) => { var _a, _b, _c; return bank.isCardProvider || ((_c = (_b = (_a = bank.cardsPastOrFutureDebit) === null || _a === void 0 ? void 0 : _a.cardsBlock) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0) > 0; });
            const cards = cardProviders.flatMap((bank) => {
                var _a, _b;
                return ((_b = (_a = bank.cardsPastOrFutureDebit) === null || _a === void 0 ? void 0 : _a.cardsBlock) !== null && _b !== void 0 ? _b : []).map((card) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return ({
                        providerId: (_c = (_b = (_a = bank._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : null,
                        providerName: bank.bankName,
                        cardUniqueId: (_d = card.cardUniqueId) !== null && _d !== void 0 ? _d : null,
                        cardName: (_e = card.cardName) !== null && _e !== void 0 ? _e : null,
                        cardFamilyDescription: (_f = card.cardFamilyDescription) !== null && _f !== void 0 ? _f : null,
                        cardTypeDescription: (_g = card.cardTypeDescription) !== null && _g !== void 0 ? _g : null,
                        cardLast4: card.last4Digits || String((_h = card.cardNumber) !== null && _h !== void 0 ? _h : '').slice(-4) || null,
                        holderName: [card.firstName, card.lastName].filter(Boolean).join(' ') || null,
                        framework: roundAmount(Number(card.cardFramework) || 0),
                        frameworkUsed: roundAmount(Number(card.cardFrameworkUsed) || 0),
                        frameworkAvailable: roundAmount(Number(card.cardFrameworkNotUsed) || Math.max(0, (Number(card.cardFramework) || 0) - (Number(card.cardFrameworkUsed) || 0))),
                        upcomingDebitDate: card.dateOfUpcomingDebit || null,
                        upcomingDebitNIS: roundAmount(Number(card.NISTotalDebit) || 0),
                        statusCode: (_j = card.cardStatusCode) !== null && _j !== void 0 ? _j : null,
                    });
                });
            });
            const upcomingDebitByDate = cards.reduce((acc, card) => {
                if (!card.upcomingDebitDate)
                    return acc;
                acc[card.upcomingDebitDate] = roundAmount((acc[card.upcomingDebitDate] || 0) + Number(card.upcomingDebitNIS || 0));
                return acc;
            }, {});
            const totalFramework = cards.reduce((sum, card) => sum + Number(card.framework || 0), 0);
            const totalUsed = cards.reduce((sum, card) => sum + Number(card.frameworkUsed || 0), 0);
            const totalUpcomingDebit = cards.reduce((sum, card) => sum + Number(card.upcomingDebitNIS || 0), 0);
            return {
                totalCards: cards.length,
                providerCount: cardProviders.length,
                totalFramework: roundAmount(totalFramework),
                totalFrameworkUsed: roundAmount(totalUsed),
                totalFrameworkAvailable: roundAmount(Math.max(0, totalFramework - totalUsed)),
                totalUpcomingDebitNIS: roundAmount(totalUpcomingDebit),
                upcomingDebitByDate,
                cards: cards.sort((left, right) => String(left.upcomingDebitDate || '').localeCompare(String(right.upcomingDebitDate || ''))),
            };
        });
    }
    detectSubscriptionPriceChangesForAgent(user_id, args) {
        return __awaiter(this, void 0, void 0, function* () {
            const groups = yield (0, transactions_2.detectRecurringTransactions)(user_id, { dateBasis: 'event' });
            const minChangeAmount = Math.abs(Number(args.min_change_amount) || 5);
            const minChangeRatio = Math.abs(Number(args.min_change_ratio) || 0.08);
            const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
            const includeDecreases = args.include_decreases !== false;
            const median = (values) => {
                const sorted = [...values].sort((left, right) => left - right);
                if (sorted.length === 0)
                    return 0;
                const middle = Math.floor(sorted.length / 2);
                return sorted.length % 2 === 0
                    ? (sorted[middle - 1] + sorted[middle]) / 2
                    : sorted[middle];
            };
            const changes = groups
                .filter((group) => group.kind === 'expense')
                .filter((group) => ['monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual'].includes(String(group.frequency)))
                .filter((group) => { var _a, _b; return ((_b = (_a = group.transactions) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) >= 3; })
                .map((group) => {
                var _a, _b, _c, _d, _e, _f, _g, _h;
                const orderedTransactions = [...((_a = group.transactions) !== null && _a !== void 0 ? _a : [])]
                    .sort((left, right) => String(left.eventDate || left.postingDate || '').localeCompare(String(right.eventDate || right.postingDate || '')));
                const amounts = orderedTransactions.map((transaction) => Math.abs(Number(transaction.amount) || 0));
                const latestAmount = (_b = amounts[amounts.length - 1]) !== null && _b !== void 0 ? _b : 0;
                const previousAmounts = amounts.slice(0, -1);
                const previousMedian = median(previousAmounts);
                const previousAverage = previousAmounts.length
                    ? previousAmounts.reduce((sum, value) => sum + value, 0) / previousAmounts.length
                    : 0;
                const previousMax = previousAmounts.length ? Math.max(...previousAmounts) : 0;
                const previousMin = previousAmounts.length ? Math.min(...previousAmounts) : 0;
                const stabilityRatio = previousMedian > 0 ? (previousMax - previousMin) / previousMedian : 1;
                const changeAmount = latestAmount - previousMedian;
                const changeRatio = previousMedian > 0 ? changeAmount / previousMedian : 0;
                const direction = changeAmount >= 0 ? 'increase' : 'decrease';
                return {
                    merchant: group.description,
                    source: (_c = group.source) !== null && _c !== void 0 ? _c : null,
                    frequency: group.frequency,
                    classification: (_d = group.classification) !== null && _d !== void 0 ? _d : null,
                    latestAmount: roundAmount(latestAmount),
                    previousMedian: roundAmount(previousMedian),
                    previousAverage: roundAmount(previousAverage),
                    changeAmount: roundAmount(changeAmount),
                    changeRatio: roundAmount(changeRatio * 100),
                    direction,
                    lastSeen: ((_e = orderedTransactions[orderedTransactions.length - 1]) === null || _e === void 0 ? void 0 : _e.eventDate)
                        || ((_f = orderedTransactions[orderedTransactions.length - 1]) === null || _f === void 0 ? void 0 : _f.postingDate)
                        || null,
                    previousSeen: ((_g = orderedTransactions[orderedTransactions.length - 2]) === null || _g === void 0 ? void 0 : _g.eventDate)
                        || ((_h = orderedTransactions[orderedTransactions.length - 2]) === null || _h === void 0 ? void 0 : _h.postingDate)
                        || null,
                    occurrences: orderedTransactions.length,
                    nextExpected: group.nextExpected,
                    stabilityRatio: roundAmount(stabilityRatio * 100),
                };
            })
                .filter((change) => Math.abs(Number(change.changeAmount) || 0) >= minChangeAmount)
                .filter((change) => Math.abs((Number(change.changeRatio) || 0) / 100) >= minChangeRatio)
                .filter((change) => (includeDecreases ? true : change.direction === 'increase'))
                .filter((change) => Number(change.stabilityRatio) <= 12)
                .sort((left, right) => Math.abs(Number(right.changeAmount) || 0) - Math.abs(Number(left.changeAmount) || 0))
                .slice(0, limit);
            return {
                totalChanges: changes.length,
                minChangeAmount: roundAmount(minChangeAmount),
                minChangeRatioPct: roundAmount(minChangeRatio * 100),
                changes,
            };
        });
    }
    buildMonthlyRiskLevel(projectedMonthNet, referenceAmount) {
        if (projectedMonthNet < 0) {
            return referenceAmount > 0 && Math.abs(projectedMonthNet) / referenceAmount > 0.1
                ? 'high'
                : 'medium';
        }
        return referenceAmount > 0 && projectedMonthNet / referenceAmount < 0.05 ? 'medium' : 'low';
    }
    getReadOnlyToolDefinitions() {
        return [
            {
                name: 'get_spending_by_merchant',
                description: 'Get total amount spent at a specific merchant or business.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        merchant_name: { type: 'string', description: 'Merchant name to search for.' },
                        month: { type: 'number', description: '1-12. Defaults to the current month.' },
                        year: { type: 'number', description: 'Full year. Defaults to the current year.' },
                    },
                    required: ['merchant_name'],
                },
                summarize: (args) => `Review spending for merchant ${args.merchant_name}.`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const { merchant_name, month, year } = args;
                    const { start, end } = this.getDateRange(month, year);
                    const transactions = yield this.getCardTransactionsInRange(context.user_id, start, end);
                    const matcher = new RegExp(merchant_name, 'i');
                    const matched = transactions.filter((transaction) => matcher.test(transaction.description || ''));
                    const total = matched.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
                    return {
                        merchant: merchant_name,
                        total: roundAmount(total),
                        count: matched.length,
                        period: formatDateWindow(start, end),
                    };
                }),
            },
            {
                name: 'get_category_totals',
                description: 'Get spending totals for all categories for a given month.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        month: { type: 'number', description: '1-12. Defaults to the current month.' },
                        year: { type: 'number', description: 'Full year. Defaults to the current year.' },
                    },
                },
                summarize: () => 'Review category totals.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const { start, end } = this.getDateRange(args.month, args.year);
                    const transactions = yield this.getBankTransactionsInRange(context.user_id, start, end);
                    const totalsByCategory = {};
                    for (const transaction of transactions) {
                        if (transaction.amount >= 0)
                            continue;
                        const key = String(transaction.category_id || 'uncategorized');
                        if (!totalsByCategory[key]) {
                            totalsByCategory[key] = {
                                name: transaction.category || 'Uncategorized',
                                total: 0,
                                count: 0,
                            };
                        }
                        totalsByCategory[key].total += Math.abs(transaction.amount);
                        totalsByCategory[key].count += 1;
                    }
                    return Object.values(totalsByCategory)
                        .sort((left, right) => right.total - left.total)
                        .map((entry) => (Object.assign(Object.assign({}, entry), { total: roundAmount(entry.total) })));
                }),
            },
            {
                name: 'get_monthly_summary',
                description: 'Get total income, expenses, and net for a given month.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        month: { type: 'number', description: '1-12. Defaults to the current month.' },
                        year: { type: 'number', description: 'Full year. Defaults to the current year.' },
                    },
                },
                summarize: () => 'Review the monthly summary.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const { start, end } = this.getDateRange(args.month, args.year);
                    const transactions = yield this.getBankTransactionsInRange(context.user_id, start, end);
                    let income = 0;
                    let expenses = 0;
                    for (const transaction of transactions) {
                        if (transaction.amount > 0)
                            income += transaction.amount;
                        else
                            expenses += Math.abs(transaction.amount);
                    }
                    return {
                        period: formatDateWindow(start, end),
                        income: roundAmount(income),
                        expenses: roundAmount(expenses),
                        net: roundAmount(income - expenses),
                    };
                }),
            },
            {
                name: 'get_top_merchants',
                description: 'Get the top merchants by spending amount for a given month.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        limit: { type: 'number', description: 'Number of merchants to return. Defaults to 5.' },
                        month: { type: 'number', description: '1-12. Defaults to the current month.' },
                        year: { type: 'number', description: 'Full year. Defaults to the current year.' },
                    },
                },
                summarize: () => 'Review the top merchants.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const { limit = 5, month, year } = args;
                    const { start, end } = this.getDateRange(month, year);
                    const transactions = yield this.getCardTransactionsInRange(context.user_id, start, end);
                    const byMerchant = {};
                    for (const transaction of transactions) {
                        if (transaction.amount >= 0)
                            continue;
                        const key = transaction.description || 'Unknown';
                        byMerchant[key] = (byMerchant[key] || 0) + Math.abs(transaction.amount);
                    }
                    return Object.entries(byMerchant)
                        .sort(([, left], [, right]) => right - left)
                        .slice(0, limit)
                        .map(([name, total]) => ({ name, total: roundAmount(total) }));
                }),
            },
            {
                name: 'get_recent_transactions',
                description: 'Get recent transactions, optionally filtered by source, merchant, or date range.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        merchant_name: { type: 'string', description: 'Optional merchant name filter.' },
                        transaction_type: {
                            type: 'string',
                            enum: TRANSACTION_FILTER_ENUM,
                            description: 'Optional source filter. Use account-transactions for bank/account entries or card-transactions for credit-card entries.',
                        },
                        limit: { type: 'number', description: 'Number of transactions to return. Defaults to 10.' },
                        start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format.' },
                        end_date: { type: 'string', description: 'End date in YYYY-MM-DD format.' },
                    },
                },
                summarize: () => 'Review recent transactions.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const { merchant_name, limit = 10, start_date, end_date } = args;
                    const transactionType = this.normalizeTransactionType(args.transaction_type);
                    const now = new Date();
                    const start = start_date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                    const end = end_date || now.toISOString().slice(0, 10);
                    const [bankTransactions, cardTransactions] = yield Promise.all([
                        transactionType === 'creditCards'
                            ? Promise.resolve([])
                            : this.getBankTransactionsInRange(context.user_id, start, end),
                        transactionType === 'transactions'
                            ? Promise.resolve([])
                            : this.getCardTransactionsInRange(context.user_id, start, end),
                    ]);
                    const matcher = merchant_name ? new RegExp(merchant_name, 'i') : null;
                    const taggedTransactions = [
                        ...bankTransactions.map((transaction) => ({ source: 'transactions', transaction })),
                        ...cardTransactions.map((transaction) => ({ source: 'creditCards', transaction })),
                    ];
                    const filtered = matcher
                        ? taggedTransactions.filter(({ transaction }) => matcher.test(transaction.description || ''))
                        : taggedTransactions;
                    return filtered
                        .sort((left, right) => right.transaction.eventDate.localeCompare(left.transaction.eventDate))
                        .slice(0, limit)
                        .map(({ source, transaction }) => ({
                        id: transaction._id.toString(),
                        type: source,
                        transaction_type: this.getTransactionLabel(source),
                        date: (0, transaction_semantics_1.getEventDate)(transaction),
                        description: transaction.description,
                        amount: transaction.amount,
                    }));
                }),
            },
            {
                name: 'search_transactions',
                description: 'Search transactions across bank and credit-card collections using text, category, status, direction, amount, and date filters.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        query_text: { type: 'string', description: 'Optional free-text search across description, memo, category, and counterparty.' },
                        merchant_name: { type: 'string', description: 'Optional merchant name filter, matched against the transaction description.' },
                        category_id: { type: 'string', description: 'Optional category id filter.' },
                        category_name: { type: 'string', description: 'Optional category name filter.' },
                        transaction_type: {
                            type: 'string',
                            enum: TRANSACTION_FILTER_ENUM,
                            description: 'Which transaction source to search. Use account-transactions for bank/account entries or card-transactions for credit-card entries.',
                        },
                        direction: { type: 'string', enum: ['all', 'income', 'expense'], description: 'Filter to income, expense, or both.' },
                        status: { type: 'string', enum: ['all', 'completed', 'pending'], description: 'Filter by transaction status.' },
                        start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format.' },
                        end_date: { type: 'string', description: 'End date in YYYY-MM-DD format.' },
                        min_amount: { type: 'number', description: 'Minimum absolute amount in shekels.' },
                        max_amount: { type: 'number', description: 'Maximum absolute amount in shekels.' },
                        card_last4: { type: 'string', description: 'Optional card last four digits filter.' },
                        limit: { type: 'number', description: 'Maximum number of results to return. Defaults to 20.' },
                        sort_by: { type: 'string', enum: ['date', 'amount'], description: 'Sort results by date or amount.' },
                        sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort ascending or descending.' },
                    },
                },
                summarize: () => 'Search transactions.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () { return this.searchTransactionsForAgent(context.user_id, args); }),
            },
            {
                name: 'get_account_overview',
                description: 'Get a summary of connected bank accounts, balances, main account, credentials, savings, and loan totals.',
                mode: 'read',
                schema: { type: 'object', properties: {} },
                summarize: () => 'Review the account overview.',
                execute: (_, context) => __awaiter(this, void 0, void 0, function* () { return this.getAccountOverviewForAgent(context.user_id); }),
            },
            {
                name: 'get_credit_card_snapshot',
                description: 'Get a snapshot of connected credit cards, upcoming debits, and framework usage.',
                mode: 'read',
                schema: { type: 'object', properties: {} },
                summarize: () => 'Review the credit card snapshot.',
                execute: (_, context) => __awaiter(this, void 0, void 0, function* () { return this.getCreditCardSnapshotForAgent(context.user_id); }),
            },
            {
                name: 'detect_subscription_price_changes',
                description: 'Detect recurring expense patterns whose most recent amount looks like a subscription price change.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        min_change_amount: { type: 'number', description: 'Minimum absolute amount change in shekels. Defaults to 5.' },
                        min_change_ratio: { type: 'number', description: 'Minimum relative change ratio. Defaults to 0.08 for 8%.' },
                        include_decreases: { type: 'boolean', description: 'Whether to include price decreases as well as increases. Defaults to true.' },
                        limit: { type: 'number', description: 'Maximum number of price changes to return. Defaults to 10.' },
                    },
                },
                summarize: () => 'Detect subscription price changes.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () { return this.detectSubscriptionPriceChangesForAgent(context.user_id, args); }),
            },
            {
                name: 'get_financial_health_overview',
                description: 'Get the full financial health assessment for the user.',
                mode: 'read',
                schema: { type: 'object', properties: {} },
                summarize: () => 'Review the financial health overview.',
                execute: (_, context) => __awaiter(this, void 0, void 0, function* () { return (0, financial_health_1.calculateFinancialHealth)(context.user_id, context.language); }),
            },
            {
                name: 'get_cash_flow_projection',
                description: 'Get the current month cash flow projection and risk outlook.',
                mode: 'read',
                schema: { type: 'object', properties: {} },
                summarize: () => 'Review the cash flow projection.',
                execute: (_, context) => __awaiter(this, void 0, void 0, function* () { return (0, cash_flow_projection_1.calculateCashFlowProjection)(context.user_id); }),
            },
            {
                name: 'get_forecast_details',
                description: 'Get the current spending forecast and historical comparison.',
                mode: 'read',
                schema: { type: 'object', properties: {} },
                summarize: () => 'Review the spending forecast.',
                execute: (_, context) => __awaiter(this, void 0, void 0, function* () { return (0, forecast_1.calculateForecast)(context.user_id, context.language); }),
            },
            {
                name: 'get_savings_goals_status',
                description: 'Get the list of savings goals and their progress.',
                mode: 'read',
                schema: { type: 'object', properties: {} },
                summarize: () => 'Review the savings goals.',
                execute: (_, context) => __awaiter(this, void 0, void 0, function* () {
                    const goals = yield savings_goals_1.default.fetchGoals(context.user_id, context.language);
                    const totalTarget = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
                    const totalSaved = goals.reduce((sum, goal) => sum + goal.currentAmount, 0);
                    return {
                        totalGoals: goals.length,
                        totalTarget: roundAmount(totalTarget),
                        totalSaved: roundAmount(totalSaved),
                        remaining: roundAmount(totalTarget - totalSaved),
                        goals,
                    };
                }),
            },
            {
                name: 'get_recurring_commitments',
                description: 'Get recurring income and expense commitments detected in the user account.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        kind: { type: 'string', enum: ['income', 'expense'], description: 'Optional flow filter.' },
                        source: { type: 'string', enum: ['bank', 'card'], description: 'Optional source filter.' },
                        frequency: { type: 'string', description: 'Optional frequency filter.' },
                        limit: { type: 'number', description: 'Maximum number of groups to return. Defaults to 10.' },
                    },
                },
                summarize: () => 'Review recurring commitments.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a;
                    const groups = yield (0, transactions_2.detectRecurringTransactions)(context.user_id, { dateBasis: 'event' });
                    const filtered = groups
                        .filter((group) => !args.kind || group.kind === args.kind)
                        .filter((group) => !args.source || group.source === args.source)
                        .filter((group) => !args.frequency || group.frequency === args.frequency);
                    const limit = (_a = args.limit) !== null && _a !== void 0 ? _a : 10;
                    const expenses = filtered.filter((group) => group.kind === 'expense');
                    const income = filtered.filter((group) => group.kind === 'income');
                    return {
                        totalGroups: filtered.length,
                        monthlyExpenseRunRate: roundAmount(expenses
                            .filter((group) => group.frequency === 'monthly')
                            .reduce((sum, group) => sum + group.amount, 0)),
                        monthlyIncomeRunRate: roundAmount(income
                            .filter((group) => group.frequency === 'monthly')
                            .reduce((sum, group) => sum + group.amount, 0)),
                        groups: filtered.slice(0, limit),
                    };
                }),
            },
            {
                name: 'get_budget_status',
                description: 'Get active budget limits and how close the user is to each limit for a given month.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        month: { type: 'number', description: '1-12. Defaults to the current month.' },
                        year: { type: 'number', description: 'Full year. Defaults to the current year.' },
                    },
                },
                summarize: () => 'Review budget status.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b;
                    const { start, end } = this.getDateRange(args.month, args.year);
                    const categoriesDoc = yield collections_1.Categories.findOne({ user_id: context.user_id }).exec();
                    const categories = (_a = categoriesDoc === null || categoriesDoc === void 0 ? void 0 : categoriesDoc.categories) !== null && _a !== void 0 ? _a : [];
                    const activeBudgets = categories.filter((category) => { var _a, _b, _c; return ((_a = category.maximumSpentAllowed) === null || _a === void 0 ? void 0 : _a.active) && ((_c = (_b = category.maximumSpentAllowed) === null || _b === void 0 ? void 0 : _b.maximumAmount) !== null && _c !== void 0 ? _c : 0) > 0; });
                    if (activeBudgets.length === 0) {
                        return {
                            period: formatDateWindow(start, end),
                            summary: { activeBudgets: 0, overBudget: 0, warningBudgetCount: 0 },
                            budgets: [],
                        };
                    }
                    const expenses = yield this.getUnifiedExpenseEntries(context.user_id, start, end);
                    const spendByCategory = new Map();
                    for (const entry of expenses) {
                        const key = entry.category_id || 'uncategorized';
                        spendByCategory.set(key, ((_b = spendByCategory.get(key)) !== null && _b !== void 0 ? _b : 0) + entry.amount);
                    }
                    const budgets = activeBudgets.map((category) => {
                        var _a, _b, _c, _d;
                        const maximumSpentAllowed = category.maximumSpentAllowed;
                        if (!maximumSpentAllowed) {
                            throw new models_1.ClientError(500, 'Active budget is missing maximum spend settings.');
                        }
                        const spent = roundAmount((_d = spendByCategory.get((_c = (_b = (_a = category._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : '')) !== null && _d !== void 0 ? _d : 0);
                        const limit = roundAmount(maximumSpentAllowed.maximumAmount);
                        const usageRatio = limit > 0 ? spent / limit : 0;
                        const remaining = roundAmount(limit - spent);
                        const status = spent > limit ? 'over' : usageRatio >= 0.8 ? 'warning' : 'ok';
                        return {
                            category_id: category._id.toString(),
                            name: category.name,
                            spent,
                            limit,
                            remaining,
                            usageRatio: roundAmount(usageRatio * 100),
                            status,
                        };
                    }).sort((left, right) => right.spent - left.spent);
                    return {
                        period: formatDateWindow(start, end),
                        summary: {
                            activeBudgets: budgets.length,
                            overBudget: budgets.filter((budget) => budget.status === 'over').length,
                            warningBudgetCount: budgets.filter((budget) => budget.status === 'warning').length,
                        },
                        budgets,
                    };
                }),
            },
            {
                name: 'compare_spending_periods',
                description: 'Compare spending between two explicit date ranges.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        start_date_a: { type: 'string', description: 'Start date for period A in YYYY-MM-DD format.' },
                        end_date_a: { type: 'string', description: 'End date for period A in YYYY-MM-DD format.' },
                        start_date_b: { type: 'string', description: 'Start date for period B in YYYY-MM-DD format.' },
                        end_date_b: { type: 'string', description: 'End date for period B in YYYY-MM-DD format.' },
                        top_n: { type: 'number', description: 'Number of category deltas to return. Defaults to 5.' },
                    },
                    required: ['start_date_a', 'end_date_a', 'start_date_b', 'end_date_b'],
                },
                summarize: () => 'Compare spending periods.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a;
                    const periodAEntries = yield this.getUnifiedExpenseEntries(context.user_id, args.start_date_a, args.end_date_a);
                    const periodBEntries = yield this.getUnifiedExpenseEntries(context.user_id, args.start_date_b, args.end_date_b);
                    const summarizePeriod = (entries) => ({
                        total: roundAmount(entries.reduce((sum, entry) => sum + entry.amount, 0)),
                        count: entries.length,
                    });
                    const categoryTotals = (entries) => {
                        var _a;
                        const result = new Map();
                        for (const entry of entries) {
                            const key = entry.category_id || entry.categoryName || 'uncategorized';
                            const current = (_a = result.get(key)) !== null && _a !== void 0 ? _a : { name: entry.categoryName || 'Uncategorized', total: 0 };
                            current.total += entry.amount;
                            result.set(key, current);
                        }
                        return result;
                    };
                    const periodA = summarizePeriod(periodAEntries);
                    const periodB = summarizePeriod(periodBEntries);
                    const periodACategories = categoryTotals(periodAEntries);
                    const periodBCategories = categoryTotals(periodBEntries);
                    const keys = new Set([...Array.from(periodACategories.keys()), ...Array.from(periodBCategories.keys())]);
                    const topChanges = Array.from(keys).map((key) => {
                        var _a, _b;
                        const left = (_a = periodACategories.get(key)) !== null && _a !== void 0 ? _a : { name: 'Uncategorized', total: 0 };
                        const right = (_b = periodBCategories.get(key)) !== null && _b !== void 0 ? _b : { name: left.name, total: 0 };
                        const delta = left.total - right.total;
                        return {
                            category: left.name || right.name,
                            period_a: roundAmount(left.total),
                            period_b: roundAmount(right.total),
                            delta: roundAmount(delta),
                            deltaPct: right.total > 0 ? roundAmount((delta / right.total) * 100) : null,
                        };
                    }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
                        .slice(0, (_a = args.top_n) !== null && _a !== void 0 ? _a : 5);
                    const totalDelta = periodA.total - periodB.total;
                    return {
                        period_a: Object.assign({ start: args.start_date_a, end: args.end_date_a }, periodA),
                        period_b: Object.assign({ start: args.start_date_b, end: args.end_date_b }, periodB),
                        delta: roundAmount(totalDelta),
                        deltaPct: periodB.total > 0 ? roundAmount((totalDelta / periodB.total) * 100) : null,
                        top_category_changes: topChanges,
                    };
                }),
            },
            {
                name: 'find_spending_anomalies',
                description: 'Find merchants with unusual spend in a target month compared with recent history.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        month: { type: 'number', description: '1-12. Defaults to the current month.' },
                        year: { type: 'number', description: 'Full year. Defaults to the current year.' },
                        lookback_months: { type: 'number', description: 'Historical months to compare against. Defaults to 6.' },
                        limit: { type: 'number', description: 'Maximum anomalies to return. Defaults to 5.' },
                    },
                },
                summarize: () => 'Find spending anomalies.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c, _d, _e, _f, _g;
                    const now = new Date();
                    const targetMonth = (_a = args.month) !== null && _a !== void 0 ? _a : now.getMonth() + 1;
                    const targetYear = (_b = args.year) !== null && _b !== void 0 ? _b : now.getFullYear();
                    const lookbackMonths = (_c = args.lookback_months) !== null && _c !== void 0 ? _c : 6;
                    const targetRange = this.getDateRange(targetMonth, targetYear);
                    const historicalStartCursor = addMonths(targetYear, targetMonth, -lookbackMonths);
                    const historicalStart = startOfMonth(historicalStartCursor.year, historicalStartCursor.month);
                    const historicalEndCursor = addMonths(targetYear, targetMonth, -1);
                    const historicalEnd = endOfMonth(historicalEndCursor.year, historicalEndCursor.month);
                    const [targetEntries, historicalEntries] = yield Promise.all([
                        this.getUnifiedExpenseEntries(context.user_id, targetRange.start, targetRange.end),
                        lookbackMonths > 0
                            ? this.getUnifiedExpenseEntries(context.user_id, historicalStart, historicalEnd)
                            : Promise.resolve([]),
                    ]);
                    const targetByMerchant = new Map();
                    for (const entry of targetEntries) {
                        const key = entry.normalizedDescription || entry.description || 'unknown';
                        const current = (_d = targetByMerchant.get(key)) !== null && _d !== void 0 ? _d : { name: entry.description || 'Unknown', total: 0, count: 0 };
                        current.total += entry.amount;
                        current.count += 1;
                        targetByMerchant.set(key, current);
                    }
                    const historicalByMerchantMonth = new Map();
                    for (const entry of historicalEntries) {
                        const merchantKey = entry.normalizedDescription || entry.description || 'unknown';
                        const monthKey = entry.date.slice(0, 7);
                        const current = (_e = historicalByMerchantMonth.get(merchantKey)) !== null && _e !== void 0 ? _e : new Map();
                        current.set(monthKey, ((_f = current.get(monthKey)) !== null && _f !== void 0 ? _f : 0) + entry.amount);
                        historicalByMerchantMonth.set(merchantKey, current);
                    }
                    const anomalies = Array.from(targetByMerchant.entries()).map(([merchantKey, current]) => {
                        const merchantHistory = historicalByMerchantMonth.get(merchantKey);
                        const historyTotal = merchantHistory
                            ? Array.from(merchantHistory.values()).reduce((sum, value) => sum + value, 0)
                            : 0;
                        const historicalAverage = lookbackMonths > 0 ? historyTotal / lookbackMonths : 0;
                        const increaseAmount = current.total - historicalAverage;
                        const increaseRatio = historicalAverage > 0
                            ? current.total / historicalAverage
                            : current.total > 0
                                ? null
                                : 0;
                        return {
                            merchant: current.name,
                            currentTotal: roundAmount(current.total),
                            historicalAverage: roundAmount(historicalAverage),
                            increaseAmount: roundAmount(increaseAmount),
                            increaseRatio: increaseRatio === null ? null : roundAmount(increaseRatio),
                            transactionCount: current.count,
                            isNewMerchant: !merchantHistory || merchantHistory.size === 0,
                        };
                    }).filter((item) => item.currentTotal >= 100 &&
                        (item.isNewMerchant || (item.historicalAverage > 0 && item.currentTotal >= item.historicalAverage * 1.5))).sort((left, right) => right.increaseAmount - left.increaseAmount)
                        .slice(0, (_g = args.limit) !== null && _g !== void 0 ? _g : 5);
                    return {
                        targetPeriod: formatDateWindow(targetRange.start, targetRange.end),
                        lookbackMonths,
                        anomalies,
                    };
                }),
            },
            {
                name: 'simulate_month_end_scenario',
                description: 'Simulate how extra income or expenses would change the current month-end projection.',
                mode: 'read',
                schema: {
                    type: 'object',
                    properties: {
                        adjustments: {
                            type: 'array',
                            description: 'Scenario adjustments to apply.',
                            items: {
                                type: 'object',
                                properties: {
                                    description: { type: 'string', description: 'Short description for the adjustment.' },
                                    amount: { type: 'number', description: 'Positive amount in shekels.' },
                                    type: { type: 'string', enum: ['income', 'expense'], description: 'Whether this is extra income or extra expense.' },
                                },
                                required: ['description', 'amount', 'type'],
                            },
                        },
                    },
                    required: ['adjustments'],
                },
                summarize: () => 'Simulate a month-end scenario.',
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const baseline = yield (0, cash_flow_projection_1.calculateCashFlowProjection)(context.user_id);
                    const adjustments = Array.isArray(args.adjustments) ? args.adjustments : [];
                    const normalizedAdjustments = adjustments.map((item) => ({
                        description: String(item.description || 'Scenario item'),
                        amount: roundAmount(Math.abs(Number(item.amount) || 0)),
                        type: item.type === 'income' ? 'income' : 'expense',
                    })).filter((item) => item.amount > 0);
                    const totalIncome = normalizedAdjustments
                        .filter((item) => item.type === 'income')
                        .reduce((sum, item) => sum + item.amount, 0);
                    const totalExpense = normalizedAdjustments
                        .filter((item) => item.type === 'expense')
                        .reduce((sum, item) => sum + item.amount, 0);
                    const delta = totalIncome - totalExpense;
                    const projectedMonthNet = roundAmount(baseline.projectedMonthNet + delta);
                    const projectedEndBalance = baseline.projectedEndBalance === null
                        ? null
                        : roundAmount(baseline.projectedEndBalance + delta);
                    const riskLevel = this.buildMonthlyRiskLevel(projectedMonthNet, Math.max(baseline.incomeToDate, baseline.expensesToDate, 1));
                    return {
                        baseline: {
                            projectedMonthNet: baseline.projectedMonthNet,
                            projectedEndBalance: baseline.projectedEndBalance,
                            riskLevel: baseline.riskLevel,
                        },
                        adjustments: normalizedAdjustments,
                        delta: roundAmount(delta),
                        simulated: { projectedMonthNet, projectedEndBalance, riskLevel },
                    };
                }),
            },
        ];
    }
    getMutationToolDefinitions() {
        return [
            {
                name: 'create_savings_goal',
                description: 'Stage creation of a new savings goal.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Goal name.' },
                        target_amount: { type: 'number', description: 'Target amount in shekels.' },
                        current_amount: { type: 'number', description: 'Current saved amount in shekels.' },
                        target_date: { type: 'string', description: 'Target date in YYYY-MM-DD format.' },
                    },
                    required: ['name', 'target_amount', 'target_date'],
                },
                summarize: (args) => `Create savings goal "${args.name}" for ₪${args.target_amount}.`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c, _d;
                    const goal = yield savings_goals_1.default.addGoal(context.user_id, {
                        name: args.name,
                        targetAmount: Number(args.target_amount),
                        currentAmount: Number((_a = args.current_amount) !== null && _a !== void 0 ? _a : 0),
                        targetDate: args.target_date,
                    });
                    return {
                        goal_id: (_d = (_c = (_b = goal._id) === null || _b === void 0 ? void 0 : _b.toString) === null || _c === void 0 ? void 0 : _c.call(_b)) !== null && _d !== void 0 ? _d : '',
                        name: goal.name,
                        targetAmount: goal.targetAmount,
                    };
                }),
                buildResultReply: (args, result, language) => localize(language, `Created the savings goal **${result.name || args.name}** with a target of **₪${roundAmount(result.targetAmount || args.target_amount)}**.`, `יצרתי את יעד החיסכון **${result.name || args.name}** עם יעד של **₪${roundAmount(result.targetAmount || args.target_amount)}**.`),
            },
            {
                name: 'update_savings_goal',
                description: 'Stage updates to an existing savings goal.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        goal_id: { type: 'string', description: 'Savings goal id.' },
                        name: { type: 'string', description: 'Updated goal name.' },
                        target_amount: { type: 'number', description: 'Updated target amount.' },
                        current_amount: { type: 'number', description: 'Updated current amount.' },
                        target_date: { type: 'string', description: 'Updated target date in YYYY-MM-DD format.' },
                    },
                    required: ['goal_id'],
                },
                summarize: (args) => `Update savings goal ${args.goal_id}.`,
                argsPreview: (args) => ({
                    goal_id: args.goal_id,
                    name: args.name,
                    target_amount: args.target_amount,
                    current_amount: args.current_amount,
                    target_date: args.target_date,
                }),
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c, _d, _e, _f, _g;
                    const goal = yield this.getSavingsGoalById(context.user_id, args.goal_id);
                    goal.name = (_a = args.name) !== null && _a !== void 0 ? _a : goal.name;
                    goal.targetAmount = (_b = args.target_amount) !== null && _b !== void 0 ? _b : goal.targetAmount;
                    goal.currentAmount = (_c = args.current_amount) !== null && _c !== void 0 ? _c : goal.currentAmount;
                    goal.targetDate = (_d = args.target_date) !== null && _d !== void 0 ? _d : goal.targetDate;
                    const updated = yield savings_goals_1.default.updateGoal(context.user_id, goal);
                    return {
                        goal_id: (_g = (_f = (_e = updated._id) === null || _e === void 0 ? void 0 : _e.toString) === null || _f === void 0 ? void 0 : _f.call(_e)) !== null && _g !== void 0 ? _g : args.goal_id,
                        name: updated.name,
                    };
                }),
                buildResultReply: (args, result, language) => localize(language, `Updated the savings goal **${result.name || args.goal_id}**.`, `עדכנתי את יעד החיסכון **${result.name || args.goal_id}**.`),
            },
            {
                name: 'delete_savings_goal',
                description: 'Stage deletion of a savings goal.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        goal_id: { type: 'string', description: 'Savings goal id.' },
                    },
                    required: ['goal_id'],
                },
                summarize: (args) => `Delete savings goal ${args.goal_id}.`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const existingGoal = yield this.getSavingsGoalById(context.user_id, args.goal_id);
                    const goalName = existingGoal.name;
                    yield savings_goals_1.default.removeGoal(context.user_id, args.goal_id);
                    return { goal_id: args.goal_id, name: goalName };
                }),
                buildResultReply: (args, result, language) => localize(language, `Deleted the savings goal **${result.name || args.goal_id}**.`, `מחקתי את יעד החיסכון **${result.name || args.goal_id}**.`),
            },
            {
                name: 'create_category',
                description: 'Stage creation of a new category.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Category name.' },
                    },
                    required: ['name'],
                },
                summarize: (args) => `Create category "${args.name}".`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c;
                    const category = yield categories_1.default.addNewCategory(args.name, context.user_id);
                    return {
                        category_id: (_c = (_b = (_a = category._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : '',
                        name: category.name,
                    };
                }),
                buildResultReply: (args, result, language) => localize(language, `Created the category **${result.name || args.name}**.`, `יצרתי את הקטגוריה **${result.name || args.name}**.`),
            },
            {
                name: 'rename_category',
                description: 'Stage renaming an existing category.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        category_id: { type: 'string', description: 'Category id.' },
                        category_name: { type: 'string', description: 'Current category name if the id is unknown.' },
                        new_name: { type: 'string', description: 'New category name.' },
                    },
                    required: ['new_name'],
                },
                summarize: (args) => `Rename category to "${args.new_name}".`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c;
                    const category = yield this.resolveCategory(context.user_id, {
                        category_id: args.category_id,
                        category_name: args.category_name,
                    });
                    const existingWithNewName = yield categories_1.default.fetchUserCategory(context.user_id, args.new_name);
                    if (existingWithNewName && existingWithNewName._id.toString() !== category._id.toString()) {
                        throw new models_1.ClientError(409, 'Category name is already in use.');
                    }
                    category.name = args.new_name;
                    const updated = yield categories_1.default.updateCategory(category, context.user_id);
                    return {
                        category_id: (_c = (_b = (_a = updated._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : category._id.toString(),
                        name: updated.name,
                    };
                }),
                buildResultReply: (args, result, language) => localize(language, `Renamed the category to **${result.name || args.new_name}**.`, `שיניתי את שם הקטגוריה ל-**${result.name || args.new_name}**.`),
            },
            {
                name: 'update_category_budget',
                description: 'Stage updates to a category budget limit.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        category_id: { type: 'string', description: 'Category id.' },
                        category_name: { type: 'string', description: 'Category name if the id is unknown.' },
                        maximum_amount: { type: 'number', description: 'Budget cap in shekels.' },
                        active: { type: 'boolean', description: 'Whether the budget cap should stay active.' },
                    },
                    required: ['maximum_amount'],
                },
                summarize: (args) => `Update category budget to ₪${args.maximum_amount}.`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c, _d, _e, _f;
                    const category = yield this.resolveCategory(context.user_id, {
                        category_id: args.category_id,
                        category_name: args.category_name,
                    });
                    category.maximumSpentAllowed = {
                        active: (_a = args.active) !== null && _a !== void 0 ? _a : true,
                        maximumAmount: Number(args.maximum_amount),
                    };
                    const updated = yield categories_1.default.updateCategory(category, context.user_id);
                    return {
                        category_id: (_d = (_c = (_b = updated._id) === null || _b === void 0 ? void 0 : _b.toString) === null || _c === void 0 ? void 0 : _c.call(_b)) !== null && _d !== void 0 ? _d : category._id.toString(),
                        name: updated.name,
                        maximumAmount: (_f = (_e = updated.maximumSpentAllowed) === null || _e === void 0 ? void 0 : _e.maximumAmount) !== null && _f !== void 0 ? _f : Number(args.maximum_amount),
                    };
                }),
                buildResultReply: (_, result, language) => localize(language, `Updated the budget for **${result.name}** to **₪${roundAmount(result.maximumAmount)}**.`, `עדכנתי את התקציב של **${result.name}** ל-**₪${roundAmount(result.maximumAmount)}**.`),
            },
            {
                name: 'confirm_recurring_pattern',
                description: 'Stage confirmation for a recurring pattern.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        pattern_id: { type: 'string', description: 'Recurring pattern id.' },
                    },
                    required: ['pattern_id'],
                },
                summarize: (args) => `Confirm recurring pattern ${args.pattern_id}.`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const updated = yield (0, pattern_service_1.overridePattern)(context.user_id, args.pattern_id, { confirmed: true });
                    if (!updated)
                        throw new models_1.ClientError(404, 'Recurring pattern not found.');
                    return { pattern_id: args.pattern_id };
                }),
                buildResultReply: (_, result, language) => localize(language, `Confirmed the recurring pattern **${result.pattern_id}**.`, `אישרתי את הדפוס החוזר **${result.pattern_id}**.`),
            },
            {
                name: 'disable_recurring_pattern',
                description: 'Stage disabling of a recurring pattern.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        pattern_id: { type: 'string', description: 'Recurring pattern id.' },
                    },
                    required: ['pattern_id'],
                },
                summarize: (args) => `Disable recurring pattern ${args.pattern_id}.`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const updated = yield (0, pattern_service_1.overridePattern)(context.user_id, args.pattern_id, { disabled: true });
                    if (!updated)
                        throw new models_1.ClientError(404, 'Recurring pattern not found.');
                    return { pattern_id: args.pattern_id };
                }),
                buildResultReply: (_, result, language) => localize(language, `Disabled the recurring pattern **${result.pattern_id}**.`, `נטרלתי את הדפוס החוזר **${result.pattern_id}**.`),
            },
            {
                name: 'update_recurring_pattern',
                description: 'Stage overrides for a recurring pattern amount, frequency, or classification.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        pattern_id: { type: 'string', description: 'Recurring pattern id.' },
                        custom_amount: { type: 'number', description: 'Updated recurring amount in shekels.' },
                        custom_frequency: { type: 'string', description: 'Updated recurring frequency.' },
                        custom_classification: { type: 'string', description: 'Updated classification label.' },
                        confirmed: { type: 'boolean', description: 'Optional confirmed override.' },
                        disabled: { type: 'boolean', description: 'Optional disabled override.' },
                    },
                    required: ['pattern_id'],
                },
                summarize: (args) => `Update recurring pattern ${args.pattern_id}.`,
                argsPreview: (args) => ({
                    pattern_id: args.pattern_id,
                    custom_amount: args.custom_amount,
                    custom_frequency: args.custom_frequency,
                    custom_classification: args.custom_classification,
                    confirmed: args.confirmed,
                    disabled: args.disabled,
                }),
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    const patch = {};
                    if (args.custom_amount !== undefined)
                        patch.customAmount = Number(args.custom_amount);
                    if (args.custom_frequency !== undefined)
                        patch.customFrequency = String(args.custom_frequency);
                    if (args.custom_classification !== undefined)
                        patch.customClassification = String(args.custom_classification);
                    if (args.confirmed !== undefined)
                        patch.confirmed = Boolean(args.confirmed);
                    if (args.disabled !== undefined)
                        patch.disabled = Boolean(args.disabled);
                    if (Object.keys(patch).length === 0) {
                        throw new models_1.ClientError(400, 'No recurring override fields were provided.');
                    }
                    const updated = yield (0, pattern_service_1.overridePattern)(context.user_id, args.pattern_id, patch);
                    if (!updated)
                        throw new models_1.ClientError(404, 'Recurring pattern not found.');
                    return { pattern_id: args.pattern_id };
                }),
                buildResultReply: (_, result, language) => localize(language, `Updated the recurring pattern **${result.pattern_id}**.`, `עדכנתי את הדפוס החוזר **${result.pattern_id}**.`),
            },
            {
                name: 'reassign_transaction_category',
                description: 'Stage reassignment of a transaction to a different category.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        transaction_id: { type: 'string', description: 'Transaction id.' },
                        transaction_type: {
                            type: 'string',
                            enum: TRANSACTION_SOURCE_ENUM,
                            description: 'Transaction collection type when known. Use account-transactions for bank/account entries or card-transactions for credit-card entries.',
                        },
                        category_id: { type: 'string', description: 'Target category id.' },
                        category_name: { type: 'string', description: 'Target category name when the id is unknown.' },
                    },
                    required: ['transaction_id'],
                },
                summarize: (args) => `Reassign transaction ${args.transaction_id} to another category.`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c;
                    const category = yield this.resolveCategory(context.user_id, {
                        category_id: args.category_id,
                        category_name: args.category_name,
                    });
                    const { transaction, type } = yield this.resolveTransaction(context.user_id, args.transaction_id, args.transaction_type);
                    transaction.category_id = category._id;
                    const updated = yield transactions_2.default.updateTransaction(context.user_id, transaction, type);
                    return {
                        transaction_id: (_c = (_b = (_a = updated._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : args.transaction_id,
                        category_name: category.name,
                        description: updated.description,
                    };
                }),
                buildResultReply: (_, result, language) => localize(language, `Reassigned **${result.description || 'the transaction'}** to **${result.category_name}**.`, `שיייכתי מחדש את **${result.description || 'העסקה'}** ל-**${result.category_name}**.`),
            },
            {
                name: 'edit_transaction',
                description: 'Stage edits to an existing transaction.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        transaction_id: { type: 'string', description: 'Transaction id.' },
                        transaction_type: {
                            type: 'string',
                            enum: TRANSACTION_SOURCE_ENUM,
                            description: 'Transaction collection type when known. Use account-transactions for bank/account entries or card-transactions for credit-card entries.',
                        },
                        description: { type: 'string', description: 'Updated description.' },
                        amount: { type: 'number', description: 'Updated signed amount.' },
                        event_date: { type: 'string', description: 'Updated event date in YYYY-MM-DD format.' },
                        posting_date: { type: 'string', description: 'Updated posting date in YYYY-MM-DD format.' },
                        category_id: { type: 'string', description: 'Updated category id.' },
                        category_name: { type: 'string', description: 'Updated category name when id is unknown.' },
                    },
                    required: ['transaction_id'],
                },
                summarize: (args) => `Edit transaction ${args.transaction_id}.`,
                argsPreview: (args) => ({
                    transaction_id: args.transaction_id,
                    description: args.description,
                    amount: args.amount,
                    event_date: args.event_date,
                    posting_date: args.posting_date,
                    category_id: args.category_id,
                    category_name: args.category_name,
                }),
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                    const { transaction, type } = yield this.resolveTransaction(context.user_id, args.transaction_id, args.transaction_type);
                    const updatedCategory = args.category_id || args.category_name
                        ? yield this.resolveCategory(context.user_id, { category_id: args.category_id, category_name: args.category_name })
                        : null;
                    const hasAnyUpdate = [
                        args.description,
                        args.amount,
                        args.event_date,
                        args.posting_date,
                        args.category_id,
                        args.category_name,
                    ].some((value) => value !== undefined);
                    if (!hasAnyUpdate) {
                        throw new models_1.ClientError(400, 'No transaction update fields were provided.');
                    }
                    transaction.description = (_a = args.description) !== null && _a !== void 0 ? _a : transaction.description;
                    transaction.amount = (_b = args.amount) !== null && _b !== void 0 ? _b : transaction.amount;
                    transaction.eventDate = (_c = args.event_date) !== null && _c !== void 0 ? _c : transaction.eventDate;
                    transaction.postingDate = (_d = args.posting_date) !== null && _d !== void 0 ? _d : transaction.postingDate;
                    transaction.date = (_f = (_e = args.event_date) !== null && _e !== void 0 ? _e : transaction.date) !== null && _f !== void 0 ? _f : transaction.eventDate;
                    transaction.processedDate = (_h = (_g = args.posting_date) !== null && _g !== void 0 ? _g : transaction.processedDate) !== null && _h !== void 0 ? _h : transaction.postingDate;
                    if (updatedCategory === null || updatedCategory === void 0 ? void 0 : updatedCategory._id) {
                        transaction.category_id = updatedCategory._id;
                    }
                    const updated = yield transactions_2.default.updateTransaction(context.user_id, transaction, type);
                    return {
                        transaction_id: (_l = (_k = (_j = updated._id) === null || _j === void 0 ? void 0 : _j.toString) === null || _k === void 0 ? void 0 : _k.call(_j)) !== null && _l !== void 0 ? _l : args.transaction_id,
                        description: updated.description,
                        amount: updated.amount,
                    };
                }),
                buildResultReply: (_, result, language) => localize(language, `Updated **${result.description || 'the transaction'}** to **₪${roundAmount(result.amount)}**.`, `עדכנתי את **${result.description || 'העסקה'}** ל-**₪${roundAmount(result.amount)}**.`),
            },
            {
                name: 'refresh_bank_account',
                description: 'Stage a refresh for a connected bank account.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        bank_id: { type: 'string', description: 'Bank account id.' },
                    },
                    required: ['bank_id'],
                },
                summarize: (args) => `Refresh bank account ${args.bank_id}.`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c;
                    const bank = yield banks_1.default.fetchOneBankAccount(context.user_id, args.bank_id);
                    if (!bank)
                        throw new models_1.ClientError(404, 'Bank account not found.');
                    const refreshed = yield banks_1.default.refreshBankData(args.bank_id, context.user_id);
                    return {
                        bank_id: args.bank_id,
                        bank_name: bank.bankName || ((_a = bank.details) === null || _a === void 0 ? void 0 : _a.accountNumber) || args.bank_id,
                        importedTransactions: (_c = (_b = refreshed.importedTransactions) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0,
                    };
                }),
                buildResultReply: (_, result, language) => localize(language, `Refreshed **${result.bank_name}** and imported **${result.importedTransactions}** transactions.`, `רעננתי את **${result.bank_name}** וייבאתי **${result.importedTransactions}** עסקאות.`),
            },
            {
                name: 'set_main_bank_account',
                description: 'Stage a change to the main bank account.',
                mode: 'mutate',
                schema: {
                    type: 'object',
                    properties: {
                        bank_id: { type: 'string', description: 'Bank account id.' },
                    },
                    required: ['bank_id'],
                },
                summarize: (args) => `Set bank account ${args.bank_id} as the main account.`,
                execute: (args, context) => __awaiter(this, void 0, void 0, function* () {
                    var _a;
                    const bank = yield banks_1.default.fetchOneBankAccount(context.user_id, args.bank_id);
                    if (!bank)
                        throw new models_1.ClientError(404, 'Bank account not found.');
                    yield banks_1.default.setMainBankAccount(context.user_id, args.bank_id);
                    return {
                        bank_id: args.bank_id,
                        bank_name: bank.bankName || ((_a = bank.details) === null || _a === void 0 ? void 0 : _a.accountNumber) || args.bank_id,
                    };
                }),
                buildResultReply: (_, result, language) => localize(language, `Set **${result.bank_name}** as the main bank account.`, `הגדרתי את **${result.bank_name}** כחשבון הבנק הראשי.`),
            },
        ];
    }
    getToolDefinitions() {
        return [
            ...this.getReadOnlyToolDefinitions(),
            ...this.getMutationToolDefinitions(),
        ];
    }
}
exports.default = new AgentChatLogic();
