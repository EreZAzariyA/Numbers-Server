import { Content, GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { TransactionStatuses } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import {
  AgentPendingActions,
  CardTransactions,
  Categories,
  ChatHistory,
  SavingsGoals,
  Transactions,
} from '../collections';
import type { IAgentPendingActionCollection } from '../collections/AgentPendingActions';
import bankLogic from './banks';
import { calculateCashFlowProjection } from './cash-flow-projection';
import categoriesLogic from './categories';
import { calculateFinancialHealth } from './financial-health';
import { calculateForecast } from './forecast';
import { normalize } from './recurring/normalization';
import { overridePattern } from './recurring/pattern-service';
import savingsGoalsLogic from './savings-goals';
import transactionsLogic, { detectRecurringTransactions } from './transactions';
import { ClientError } from '../models';
import type { ICategories, ICategoryModel } from '../models';
import type { ISavingsGoalModel } from '../models/savings-goal-model';
import config from '../utils/config';
import { socketIo } from '../dal/socket';
import { buildSettlementTreatmentMap, classifySettlement } from '../utils/settlement-detection';
import type { MainTransactionType, PatternClass } from '../utils/types';
import { getEventDate, getPostingDate, getTransactionAmount, getTransactionTextSource } from '../utils/transaction-semantics';
import { getAiRateLimitMessage } from '../utils/ai-provider';
import aiSettingsLogic from './ai-settings';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type ToolMode = 'read' | 'mutate';
type AgentActionStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';
type TransactionCollectionType = 'transactions' | 'creditCards';
type AgentTransactionFilterType = 'all' | TransactionCollectionType;
type AgentTransactionLabel = 'account-transactions' | 'card-transactions';
type SupportedLanguage = 'en' | 'he';

type ToolSchemaProperty = {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolSchemaProperty>;
  required?: string[];
  items?: ToolSchemaProperty;
};

type ToolSchema = {
  type: 'object';
  properties: Record<string, ToolSchemaProperty>;
  required?: string[];
};

type PendingActionView = {
  id: string;
  tool: string;
  summary: string;
  argsPreview: Record<string, unknown>;
  expiresAt: string;
};

type AgentChatResponse = {
  reply: string;
  pendingAction?: PendingActionView | null;
};

type HistoryResponse = {
  messages: ChatMessage[];
  pendingAction?: PendingActionView | null;
};

type ToolExecutionContext = {
  user_id: string;
  language: SupportedLanguage;
  stageMutations: boolean;
  stagedActionRef: { value: PendingActionView | null };
  toolUsageRef?: {
    names: string[];
    usedAnyTool: boolean;
    usedReadTool: boolean;
  };
  emitProgress?: (step: string, toolName?: string, status?: 'active' | 'complete' | 'error') => void;
};

type AgentProgressEvent = {
  requestId: string;
  step: string;
  label: string;
  status: 'active' | 'complete' | 'error';
  at: string;
  tool?: string;
};

type AgentToolDefinition = {
  name: string;
  description: string;
  mode: ToolMode;
  schema: ToolSchema;
  summarize: (args: Record<string, any>) => string;
  argsPreview?: (args: Record<string, any>) => Record<string, unknown>;
  execute: (args: Record<string, any>, context: ToolExecutionContext) => Promise<any>;
  buildResultReply?: (
    args: Record<string, any>,
    result: any,
    language: SupportedLanguage,
  ) => string;
};

type UnifiedExpenseEntry = {
  amount: number;
  category_id?: string;
  categoryName?: string;
  description: string;
  normalizedDescription: string;
  date: string;
};

type AgentSearchTransactionResult = {
  id: string;
  type: TransactionCollectionType;
  transaction_type: AgentTransactionLabel;
  date: string | null;
  postingDate: string | null;
  description: string;
  amount: number;
  status: string;
  companyId: string | null;
  category_id: string | null;
  category: string | null;
  cardLast4: string | number | null;
  counterparty: string | null;
};

type BudgetStatusItem = {
  category_id: string;
  name: string;
  spent: number;
  limit: number;
  remaining: number;
  usageRatio: number;
  status: 'ok' | 'warning' | 'over';
};

type AgentTransactionRecord = {
  _id: { toString(): string };
  eventDate: string;
  postingDate?: string;
  date?: string;
  processedDate?: string;
  category_id?: { toString(): string } | string;
  description?: string;
  amount: number;
  status?: string;
  companyId?: string;
  memo?: string;
  providerCategoryName?: string;
  counterparty?: string;
  category?: string;
  cardLast4?: string | number;
  cardNumber?: string | number;
  installments?: { number?: number; total?: number };
  type?: unknown;
};

type AgentCardSnapshotSource = {
  cardUniqueId?: string;
  cardName?: string;
  cardFamilyDescription?: string;
  cardTypeDescription?: string;
  last4Digits?: string | number;
  cardNumber?: string | number;
  firstName?: string;
  lastName?: string;
  cardFramework?: string | number;
  cardFrameworkUsed?: string | number;
  cardFrameworkNotUsed?: string | number;
  dateOfUpcomingDebit?: string;
  NISTotalDebit?: string | number;
  cardStatusCode?: string | number;
};

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 5;
const PENDING_ACTION_TTL_MS = 1000 * 60 * 10;
const TRANSACTION_SOURCE_ENUM = ['account-transactions', 'card-transactions', 'transactions', 'creditCards'];
const TRANSACTION_FILTER_ENUM = ['all', ...TRANSACTION_SOURCE_ENUM];
const TRANSACTION_TYPE_ALIASES: Record<string, AgentTransactionFilterType> = {
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

const roundAmount = (value: number): number => Math.round((value || 0) * 100) / 100;

const startOfMonth = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}-01`;

const endOfMonth = (year: number, month: number): string => {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};

const addOneDay = (date: string): string => {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

const buildInclusiveDateRangeFilter = (start: string, end: string): Record<string, string> => ({
  $gte: start,
  $lt: addOneDay(end),
});

const addMonths = (year: number, month: number, delta: number): { year: number; month: number } => {
  const current = new Date(year, month - 1 + delta, 1);
  return { year: current.getFullYear(), month: current.getMonth() + 1 };
};

const formatDateWindow = (start: string, end: string): string =>
  `${start.slice(0, 10)} to ${end.slice(0, 10)}`;

const localize = (language: SupportedLanguage, en: string, he: string): string =>
  language === 'he' ? he : en;

const toProgressStepId = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

class AgentChatLogic {
  async loadHistory(user_id: string): Promise<HistoryResponse> {
    const [doc, pendingAction] = await Promise.all([
      ChatHistory.findOne({ user_id }).lean().exec(),
      this.loadLatestPendingAction(user_id),
    ]);

    return {
      messages: doc?.messages?.map((message) => ({ role: message.role, content: message.content })) ?? [],
      pendingAction,
    };
  }

  async saveHistory(user_id: string, messages: ChatMessage[]): Promise<void> {
    const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
    const docs = trimmed.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: new Date(),
    }));

    await ChatHistory.findOneAndUpdate(
      { user_id },
      { $set: { messages: docs } },
      { upsert: true, new: true },
    ).exec();
  }

  async appendAssistantMessage(user_id: string, content: string): Promise<void> {
    if (!content?.trim()) return;
    const history = (await this.loadHistory(user_id)).messages;
    await this.saveHistory(user_id, [...history, { role: 'assistant', content }]);
  }

  async clearHistory(user_id: string): Promise<void> {
    await Promise.all([
      ChatHistory.deleteOne({ user_id }).exec(),
      this.cancelAllPendingActions(user_id),
    ]);
  }

  async chat(user_id: string, message: string, language: string, requestId?: string): Promise<AgentChatResponse> {
    if (!message?.trim()) return { reply: '' };

    const normalizedLanguage = this.normalizeLanguage(language);
    const emitProgress = this.createProgressEmitter(user_id, normalizedLanguage, requestId);
    emitProgress('reviewing-request');
    const runtime = await aiSettingsLogic.resolveProvider(user_id);
    if (!runtime.available || !runtime.model) {
      emitProgress('completed', undefined, 'complete');
      return {
        reply: localize(
          normalizedLanguage,
          'The selected AI provider is not configured. Open Settings > API Keys to finish setup.',
          'ספק ה-AI שנבחר עדיין לא מוגדר. פתח את הגדרות > מפתחות API כדי להשלים את ההגדרה.',
        ),
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const history = (await this.loadHistory(user_id)).messages;
    const updatedHistory: ChatMessage[] = [...history, { role: 'user', content: message }];
    emitProgress('loading-finance-context');
    const contextBlock = await this.buildContextBlock(user_id, normalizedLanguage);
    const stagedActionRef = { value: null as PendingActionView | null };
    const createToolUsageRef = () => ({
      names: [] as string[],
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
        ? await this.chatWithOllama(
          systemInstruction,
          updatedHistory,
          user_id,
          normalizedLanguage,
          stagedActionRef,
          runtime.model,
          toolUsageRef,
          emitProgress,
        )
        : runtime.provider === 'claude'
          ? await this.chatWithClaude(
            systemInstruction,
            updatedHistory,
            user_id,
            normalizedLanguage,
            stagedActionRef,
            runtime,
            toolUsageRef,
            emitProgress,
          )
          : await this.chatWithGemini(
            systemInstruction,
            updatedHistory,
            user_id,
            normalizedLanguage,
            stagedActionRef,
            runtime,
            toolUsageRef,
            emitProgress,
          );

      if (shouldRequireGroundedData && !toolUsageRef.usedAnyTool) {
        emitProgress('consulting-assistant');
        toolUsageRef = createToolUsageRef();
        reply = runtime.provider === 'ollama'
          ? await this.chatWithOllama(
            strictSystemInstruction,
            updatedHistory,
            user_id,
            normalizedLanguage,
            stagedActionRef,
            runtime.model,
            toolUsageRef,
            emitProgress,
            true,
          )
          : runtime.provider === 'claude'
            ? await this.chatWithClaude(
              strictSystemInstruction,
              updatedHistory,
              user_id,
              normalizedLanguage,
              stagedActionRef,
              runtime,
              toolUsageRef,
              emitProgress,
            )
            : await this.chatWithGemini(
              strictSystemInstruction,
              updatedHistory,
              user_id,
              normalizedLanguage,
              stagedActionRef,
              runtime,
              toolUsageRef,
              emitProgress,
            );
      }

      if (shouldRequireGroundedData && !toolUsageRef.usedAnyTool) {
        emitProgress('assistant-error', undefined, 'error');
        return {
          reply: localize(
            normalizedLanguage,
            'I could not verify that from live finance data, so I do not want to guess. Please try again.',
            'לא הצלחתי לאמת את זה מנתוני הכספים החיים, ולכן אני לא רוצה לנחש. נסה שוב.',
          ),
        };
      }

      emitProgress('finalizing-response');
      await this.saveHistory(user_id, [...updatedHistory, { role: 'assistant', content: reply }]);
      emitProgress('completed', undefined, 'complete');
      return { reply, pendingAction: stagedActionRef.value };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      const rateLimitReply = getAiRateLimitMessage(err, normalizedLanguage);
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
  }

  async confirmPendingAction(user_id: string, actionId: string, language: string): Promise<{ reply: string }> {
    const normalizedLanguage = this.normalizeLanguage(language);
    const action = await this.loadPendingActionOrThrow(user_id, actionId);
    const definition = this.getToolDefinition(action.tool);

    if (!definition || definition.mode !== 'mutate') {
      throw new ClientError(400, 'Pending action is not executable.');
    }

    const now = new Date();
    if (action.status !== 'pending') {
      throw new ClientError(409, this.buildInactiveActionMessage(action.status, normalizedLanguage));
    }

    if (action.expiresAt.getTime() <= now.getTime()) {
      await AgentPendingActions.findByIdAndUpdate(action._id, {
        $set: { status: 'expired', expiredAt: now },
      }).exec();
      throw new ClientError(409, this.buildInactiveActionMessage('expired', normalizedLanguage));
    }

    const result = await definition.execute(action.args ?? {}, {
      user_id,
      language: normalizedLanguage,
      stageMutations: false,
      stagedActionRef: { value: null },
    });

    await AgentPendingActions.findByIdAndUpdate(action._id, {
      $set: { status: 'confirmed', confirmedAt: now, result },
    }).exec();

    const reply = definition.buildResultReply
      ? definition.buildResultReply(action.args ?? {}, result, normalizedLanguage)
      : localize(normalizedLanguage, 'The action was completed successfully.', 'הפעולה הושלמה בהצלחה.');

    await this.appendAssistantMessage(user_id, reply);
    return { reply };
  }

  async cancelPendingAction(user_id: string, actionId: string, language: string): Promise<{ reply: string }> {
    const normalizedLanguage = this.normalizeLanguage(language);
    const action = await this.loadPendingActionOrThrow(user_id, actionId);

    if (action.status !== 'pending') {
      throw new ClientError(409, this.buildInactiveActionMessage(action.status, normalizedLanguage));
    }

    await AgentPendingActions.findByIdAndUpdate(action._id, {
      $set: { status: 'cancelled', cancelledAt: new Date() },
    }).exec();

    const reply = localize(
      normalizedLanguage,
      `Cancelled the pending action for **${action.summary}**.`,
      `ביטלתי את הפעולה הממתינה עבור **${action.summary}**.`,
    );
    await this.appendAssistantMessage(user_id, reply);
    return { reply };
  }

  private normalizeLanguage(language: string): SupportedLanguage {
    return language === 'he' ? 'he' : 'en';
  }

  private createProgressEmitter(
    user_id: string,
    language: SupportedLanguage,
    requestId?: string,
  ): ToolExecutionContext['emitProgress'] {
    if (!requestId) {
      return () => undefined;
    }

    return (step, toolName, status = 'active') => {
      const payload: AgentProgressEvent = {
        requestId,
        step,
        label: this.buildProgressLabel(language, step, toolName),
        status,
        at: new Date().toISOString(),
        tool: toolName,
      };
      socketIo.emitToUser(user_id, 'agent:progress', payload);
    };
  }

  private buildProgressLabel(language: SupportedLanguage, step: string, toolName?: string): string {
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

  private shouldRequireGroundedData(message: string): boolean {
    const normalizedMessage = message.trim().toLowerCase();
    if (!normalizedMessage) return false;

    const retrievalIntent = /\b(list|show|what|which|when|find|search|compare|total|how much|give me|tell me)\b/i;
    const financeDataTopic = /\b(transaction|transactions|spent|spend|expense|expenses|income|merchant|merchants|date|dates|balance|balances|category|categories|card|cards|bank|banks|payment|payments|wolt)\b/i;

    return retrievalIntent.test(normalizedMessage) && financeDataTopic.test(normalizedMessage);
  }

  private formatToolDisplayName(name?: string): string {
    if (!name) return 'finance data';
    return String(name)
      .replace(/[_-]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private normalizeTransactionType(type?: string | null): AgentTransactionFilterType {
    const normalizedType = String(type ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, '-');

    if (!normalizedType) return 'all';
    return TRANSACTION_TYPE_ALIASES[normalizedType] ?? 'all';
  }

  private getTransactionLabel(type: TransactionCollectionType): AgentTransactionLabel {
    return type === 'creditCards' ? 'card-transactions' : 'account-transactions';
  }

  private async chatWithGemini(
    systemInstruction: string,
    messages: ChatMessage[],
    user_id: string,
    language: SupportedLanguage,
    stagedActionRef: { value: PendingActionView | null },
    runtime: Awaited<ReturnType<typeof aiSettingsLogic.resolveProvider>>,
    toolUsageRef: NonNullable<ToolExecutionContext['toolUsageRef']>,
    emitProgress?: ToolExecutionContext['emitProgress'],
  ): Promise<string> {
    const genAI = new GoogleGenerativeAI(runtime.apiKey!);
    const model = genAI.getGenerativeModel({
      model: runtime.model!,
      systemInstruction,
      tools: [{ functionDeclarations: this.getGeminiTools() }],
    });

    const history: Content[] = messages.slice(0, -1).map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

    const chat = model.startChat({ history });
    const lastMessage = messages[messages.length - 1].content;
    let result = await chat.sendMessage(lastMessage);

    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      const parts = result.response.candidates?.[0]?.content?.parts ?? [];
      const functionCallPart = parts.find((part) => part.functionCall);
      if (!functionCallPart?.functionCall) break;

      const { name, args } = functionCallPart.functionCall;
      const toolResult = await this.executeTool(name, (args ?? {}) as Record<string, any>, {
        user_id,
        language,
        stageMutations: true,
        stagedActionRef,
        toolUsageRef,
        emitProgress,
      });

      emitProgress?.('consulting-assistant');
      result = await chat.sendMessage([{
        functionResponse: {
          name,
          response: { result: JSON.stringify(toolResult) },
        },
      }]);
    }

    return result.response.text();
  }

  private async chatWithOllama(
    systemInstruction: string,
    messages: ChatMessage[],
    user_id: string,
    language: SupportedLanguage,
    stagedActionRef: { value: PendingActionView | null },
    model: string,
    toolUsageRef: NonNullable<ToolExecutionContext['toolUsageRef']>,
    emitProgress?: ToolExecutionContext['emitProgress'],
    forceToolUse = false,
  ): Promise<string> {
    const client = new OpenAI({
      baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      apiKey: 'ollama',
    });

    const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemInstruction },
      ...messages.map((message) => ({
        role: (message.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: message.content,
      })),
    ];

    let response = await client.chat.completions.create({
      model,
      messages: history,
      tools: this.getOpenAITools(),
      ...(forceToolUse ? { tool_choice: 'required' } : {}),
    });

    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      const choice = response.choices[0];
      if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) break;

      history.push(choice.message);

      for (const call of choice.message.tool_calls) {
        if (call.type !== 'function') continue;
        const parsedArguments = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const result = await this.executeTool(call.function.name, parsedArguments, {
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

      emitProgress?.('consulting-assistant');
      response = await client.chat.completions.create({
        model,
        messages: history,
        tools: this.getOpenAITools(),
        ...(forceToolUse ? { tool_choice: 'required' } : {}),
      });
    }

    return response.choices[0].message.content ?? '';
  }

  private async chatWithClaude(
    systemInstruction: string,
    messages: ChatMessage[],
    user_id: string,
    language: SupportedLanguage,
    stagedActionRef: { value: PendingActionView | null },
    runtime: Awaited<ReturnType<typeof aiSettingsLogic.resolveProvider>>,
    toolUsageRef: NonNullable<ToolExecutionContext['toolUsageRef']>,
    emitProgress?: ToolExecutionContext['emitProgress'],
  ): Promise<string> {
    const client = new Anthropic({ apiKey: runtime.apiKey! });
    const history: any[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    let response = await client.messages.create({
      model: runtime.model!,
      max_tokens: 1200,
      system: systemInstruction,
      messages: history,
      tools: this.getAnthropicTools(),
    });

    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      const toolUses = response.content.filter((block: any) => block.type === 'tool_use');
      if (!toolUses.length) break;

      history.push({
        role: 'assistant',
        content: response.content,
      });

      const toolResults = [];
      for (const toolUse of toolUses as any[]) {
        const result = await this.executeTool(toolUse.name, (toolUse.input ?? {}) as Record<string, any>, {
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

      emitProgress?.('consulting-assistant');
      response = await client.messages.create({
        model: runtime.model!,
        max_tokens: 1200,
        system: systemInstruction,
        messages: history,
        tools: this.getAnthropicTools(),
      });
    }

    return response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n')
      .trim();
  }

  private getToolDefinition(name: string): AgentToolDefinition | undefined {
    return this.getToolDefinitions().find((definition) => definition.name === name);
  }

  private getGeminiTools(): any[] {
    return this.getToolDefinitions().map((definition) => ({
      name: definition.name,
      description: definition.description,
      parameters: this.toGeminiSchema(definition.schema),
    }));
  }

  private getOpenAITools(): OpenAI.Chat.ChatCompletionTool[] {
    return this.getToolDefinitions().map((definition) => ({
      type: 'function',
      function: {
        name: definition.name,
        description: definition.description,
        parameters: this.toOpenAISchema(definition.schema),
      },
    }));
  }

  private getAnthropicTools(): any[] {
    return this.getToolDefinitions().map((definition) => ({
      name: definition.name,
      description: definition.description,
      input_schema: this.toOpenAISchema(definition.schema),
    }));
  }

  private toOpenAISchema(schema: ToolSchema): Record<string, any> {
    const convertProperty = (property: ToolSchemaProperty): Record<string, any> => {
      const result: Record<string, any> = { type: property.type };
      if (property.description) result.description = property.description;
      if (property.enum) result.enum = property.enum;
      if (property.type === 'object') {
        result.properties = Object.fromEntries(
          Object.entries(property.properties ?? {}).map(([key, value]) => [key, convertProperty(value)]),
        );
        result.required = property.required ?? [];
      }
      if (property.type === 'array' && property.items) {
        result.items = convertProperty(property.items);
      }
      return result;
    };

    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [key, convertProperty(value)]),
      ),
      required: schema.required ?? [],
    };
  }

  private toGeminiSchema(schema: ToolSchema): Record<string, any> {
    const mapType = (type: ToolSchemaProperty['type']): SchemaType => {
      switch (type) {
        case 'string': return SchemaType.STRING;
        case 'number': return SchemaType.NUMBER;
        case 'boolean': return SchemaType.BOOLEAN;
        case 'array': return SchemaType.ARRAY;
        default: return SchemaType.OBJECT;
      }
    };

    const convertProperty = (property: ToolSchemaProperty): Record<string, any> => {
      const result: Record<string, any> = { type: mapType(property.type) };
      if (property.description) result.description = property.description;
      if (property.enum) result.enum = property.enum;
      if (property.type === 'object') {
        result.properties = Object.fromEntries(
          Object.entries(property.properties ?? {}).map(([key, value]) => [key, convertProperty(value)]),
        );
        result.required = property.required ?? [];
      }
      if (property.type === 'array' && property.items) {
        result.items = convertProperty(property.items);
      }
      return result;
    };

    return convertProperty(schema);
  }

  private async executeTool(
    name: string,
    args: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<any> {
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

    context.emitProgress?.(`tool:${toProgressStepId(definition.name)}`, definition.name);
    if (definition.mode === 'mutate' && context.stageMutations) {
      return this.stagePendingAction(definition, args, context);
    }

    return definition.execute(args, context);
  }

  private async stagePendingAction(
    definition: AgentToolDefinition,
    args: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<any> {
    if (context.stagedActionRef.value) {
      return {
        error: 'An action is already waiting for confirmation. Ask the user to confirm or cancel it first.',
      };
    }

    await this.expireStalePendingActions(context.user_id);
    await this.cancelAllPendingActions(context.user_id);

    const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS);
    const preview = definition.argsPreview ? definition.argsPreview(args) : this.buildDefaultArgsPreview(args);
    const doc = await AgentPendingActions.create({
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
    context.emitProgress?.('staging-action', definition.name);

    return {
      requires_confirmation: true,
      pending_action: pendingAction,
      message: 'The action has been staged and now requires confirmation in the chat UI.',
    };
  }

  private async loadLatestPendingAction(user_id: string): Promise<PendingActionView | null> {
    await this.expireStalePendingActions(user_id);
    const doc = await AgentPendingActions.findOne({ user_id, status: 'pending' })
      .sort({ createdAt: -1 })
      .exec();

    return doc ? this.toPendingActionView(doc) : null;
  }

  private async loadPendingActionOrThrow(
    user_id: string,
    actionId: string,
  ): Promise<IAgentPendingActionCollection> {
    await this.expireStalePendingActions(user_id);
    const action = await AgentPendingActions.findOne({ _id: actionId, user_id }).exec();
    if (!action) {
      throw new ClientError(404, 'Pending action not found.');
    }
    return action;
  }

  private async expireStalePendingActions(user_id?: string): Promise<void> {
    const now = new Date();
    const query: Record<string, any> = {
      status: 'pending',
      expiresAt: { $lte: now },
    };
    if (user_id) query.user_id = user_id;

    await AgentPendingActions.updateMany(query, {
      $set: { status: 'expired', expiredAt: now },
    }).exec();
  }

  private async cancelAllPendingActions(user_id: string): Promise<void> {
    await AgentPendingActions.updateMany({ user_id, status: 'pending' }, {
      $set: { status: 'cancelled', cancelledAt: new Date() },
    }).exec();
  }

  private toPendingActionView(
    action: Pick<IAgentPendingActionCollection, '_id' | 'tool' | 'summary' | 'argsPreview' | 'expiresAt'>,
  ): PendingActionView {
    return {
      id: action._id.toString(),
      tool: action.tool,
      summary: action.summary,
      argsPreview: action.argsPreview ?? {},
      expiresAt: action.expiresAt.toISOString(),
    };
  }

  private buildDefaultArgsPreview(args: Record<string, any>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(args).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.slice(0, 5) : value,
      ]),
    );
  }

  private buildInactiveActionMessage(status: AgentActionStatus, language: SupportedLanguage): string {
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

  private async buildContextBlock(user_id: string, language: SupportedLanguage): Promise<string> {
    const [healthResult, forecastResult, goalsResult] = await Promise.allSettled([
      calculateFinancialHealth(user_id, language),
      calculateForecast(user_id, language),
      SavingsGoals.findOne({ user_id }).lean().exec(),
    ]);

    const lines: string[] = ['--- FINANCIAL CONTEXT (pre-loaded, use as background knowledge) ---'];
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
      lines.push(
        `Month forecast: spent ₪${forecast.currentMonthSpend} so far, projected ₪${forecast.forecastAmount} by month-end ` +
        `(avg ₪${forecast.averageMonthlySpend}/month, trend: ${forecast.trend}, ${forecast.daysRemaining} days remaining)`,
      );
    }

    if (goalsResult.status === 'fulfilled' && goalsResult.value?.goals?.length) {
      hasAny = true;
      lines.push('Savings goals:');
      for (const goal of goalsResult.value.goals) {
        const progress = goal.targetAmount > 0 ? Math.round((goal.currentAmount / goal.targetAmount) * 100) : 0;
        const targetDate = goal.targetDate ? `, target date: ${goal.targetDate}` : '';
        lines.push(`  - ${goal.name}: ₪${goal.currentAmount}/₪${goal.targetAmount} (${progress}%${targetDate})`);
      }
    }

    if (!hasAny) return '';
    lines.push('--- END FINANCIAL CONTEXT ---');
    return `\n\n${lines.join('\n')}`;
  }

  private getDateRange(month?: number, year?: number): { start: string; end: string } {
    const now = new Date();
    const normalizedMonth = month ?? now.getMonth() + 1;
    const normalizedYear = year ?? now.getFullYear();
    return {
      start: startOfMonth(normalizedYear, normalizedMonth),
      end: endOfMonth(normalizedYear, normalizedMonth),
    };
  }

  private async getBankTransactionsInRange(user_id: string, start: string, end: string) {
    return Transactions.find({ user_id, eventDate: buildInclusiveDateRangeFilter(start, end) }).lean().exec();
  }

  private async getCardTransactionsInRange(user_id: string, start: string, end: string) {
    return CardTransactions.find({ user_id, eventDate: buildInclusiveDateRangeFilter(start, end) }).lean().exec();
  }

  private async getCompletedTransactionsInRange(user_id: string, start: string, end: string) {
    return Promise.all([
      Transactions.find({
        user_id,
        status: TransactionStatuses.Completed,
        eventDate: buildInclusiveDateRangeFilter(start, end),
      }).lean().exec(),
      CardTransactions.find({
        user_id,
        status: TransactionStatuses.Completed,
        eventDate: buildInclusiveDateRangeFilter(start, end),
      }).lean().exec(),
    ]);
  }

  private async getUnifiedExpenseEntries(user_id: string, start: string, end: string): Promise<UnifiedExpenseEntry[]> {
    const [regularTransactions, cardTransactions] = await this.getCompletedTransactionsInRange(user_id, start, end);
    const hasCardData = cardTransactions.length > 0;
    const settlementTreatments = buildSettlementTreatmentMap(regularTransactions, cardTransactions);

    return [...regularTransactions, ...cardTransactions]
      .map((transaction: AgentTransactionRecord) => {
        const amount = getTransactionAmount(transaction);
        const treatment = settlementTreatments.get(transaction._id?.toString?.() ?? '')
          ?? classifySettlement(getTransactionTextSource(transaction), hasCardData);
        return { transaction, amount, treatment };
      })
      .filter(({ amount, treatment }) => amount < 0 && treatment !== 'exclude')
      .map(({ transaction, amount }) => ({
        amount: Math.abs(amount),
        category_id: transaction.category_id?.toString?.() ?? '',
        categoryName: transaction.category || transaction.providerCategoryName || 'Uncategorized',
        description: transaction.description ?? '',
        normalizedDescription: normalize(transaction.description ?? ''),
        date: getPostingDate(transaction) || getEventDate(transaction),
      }));
  }

  private async resolveCategory(
    user_id: string,
    options: { category_id?: string; category_name?: string },
  ): Promise<ICategoryModel> {
    const categoriesDoc = await Categories.findOne({ user_id }).exec();
    const categories = categoriesDoc?.categories ?? [];

    if (options.category_id) {
      const found = categories.find((category) => category._id.toString() === options.category_id);
      if (found) return found;
    }

    if (options.category_name) {
      const normalizedName = options.category_name.trim().toLowerCase();
      const found = categories.find((category) => category.name?.trim().toLowerCase() === normalizedName);
      if (found) return found;
    }

    throw new ClientError(404, 'Category not found.');
  }

  private async resolveTransaction(
    user_id: string,
    transactionId: string,
    type?: string,
  ): Promise<{ transaction: MainTransactionType; type: TransactionCollectionType }> {
    if (!transactionId) {
      throw new ClientError(400, 'Transaction id is required.');
    }

    const normalizedType = this.normalizeTransactionType(type);

    if (normalizedType === 'transactions') {
      const transaction = await Transactions.findOne({ _id: transactionId, user_id }).exec();
      if (!transaction) throw new ClientError(404, 'Transaction not found.');
      return { transaction: transaction as MainTransactionType, type: 'transactions' };
    }

    if (normalizedType === 'creditCards') {
      const transaction = await CardTransactions.findOne({ _id: transactionId, user_id }).exec();
      if (!transaction) throw new ClientError(404, 'Transaction not found.');
      return { transaction: transaction as MainTransactionType, type: 'creditCards' };
    }

    const [bankTransaction, cardTransaction] = await Promise.all([
      Transactions.findOne({ _id: transactionId, user_id }).exec(),
      CardTransactions.findOne({ _id: transactionId, user_id }).exec(),
    ]);

    if (bankTransaction) return { transaction: bankTransaction as MainTransactionType, type: 'transactions' };
    if (cardTransaction) return { transaction: cardTransaction as MainTransactionType, type: 'creditCards' };

    throw new ClientError(404, 'Transaction not found.');
  }

  private async getSavingsGoalById(user_id: string, goalId: string): Promise<ISavingsGoalModel> {
    const doc = await SavingsGoals.findOne({ user_id, 'goals._id': goalId }).exec();
    const goal = doc?.goals?.find((item) => item._id.toString() === goalId);
    if (!goal) {
      throw new ClientError(404, 'Savings goal not found.');
    }
    return goal;
  }

  private async searchTransactionsForAgent(
    user_id: string,
    args: Record<string, any>,
  ): Promise<{
    totalMatches: number;
    transactions: Array<Record<string, unknown>>;
    appliedFilters: Record<string, unknown>;
  }> {
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
      ? await this.resolveCategory(user_id, {
        category_id: args.category_id,
        category_name: args.category_name,
      })
      : null;

    const query: Record<string, any> = {
      user_id,
      eventDate: buildInclusiveDateRangeFilter(startDate, endDate),
    };
    if (status !== 'all') {
      query.status = status;
    }
    if (category?._id) {
      query.category_id = category._id;
    }

    const [bankTransactions, cardTransactions] = await Promise.all([
      transactionType === 'creditCards' ? Promise.resolve([]) : Transactions.find(query).lean().exec(),
      transactionType === 'transactions' ? Promise.resolve([]) : CardTransactions.find(query).lean().exec(),
    ]);

    const normalizedQuery = String(args.query_text || '').trim().toLowerCase();
    const normalizedMerchant = String(args.merchant_name || '').trim().toLowerCase();
    const normalizedCardLast4 = String(args.card_last4 || '').trim();

    const matchesText = (transaction: AgentTransactionRecord): boolean => {
      const haystack = [
        transaction.description,
        transaction.memo,
        transaction.providerCategoryName,
        transaction.counterparty,
        transaction.category,
        transaction.cardLast4,
      ].filter(Boolean).join(' ').toLowerCase();

      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false;
      if (normalizedMerchant && !(transaction.description || '').toLowerCase().includes(normalizedMerchant)) return false;
      if (normalizedCardLast4 && String(transaction.cardLast4 || transaction.cardNumber || '').slice(-4) !== normalizedCardLast4) return false;
      return true;
    };

    const matchesAmount = (transaction: AgentTransactionRecord): boolean => {
      const absoluteAmount = Math.abs(Number(transaction.amount) || 0);
      if (minAmount !== null && absoluteAmount < minAmount) return false;
      if (maxAmount !== null && absoluteAmount > maxAmount) return false;
      return true;
    };

    const matchesDirection = (transaction: AgentTransactionRecord): boolean => {
      if (direction === 'all') return true;
      if (direction === 'income') return Number(transaction.amount) > 0;
      return Number(transaction.amount) < 0;
    };

    const taggedTransactions: Array<{ source: TransactionCollectionType; transaction: AgentTransactionRecord }> = [
      ...bankTransactions.map((transaction) => ({ source: 'transactions' as TransactionCollectionType, transaction })),
      ...cardTransactions.map((transaction) => ({ source: 'creditCards' as TransactionCollectionType, transaction })),
    ];

    const transactions: AgentSearchTransactionResult[] = taggedTransactions
      .filter(({ transaction }) => matchesDirection(transaction))
      .filter(({ transaction }) => matchesAmount(transaction))
      .filter(({ transaction }) => matchesText(transaction))
      .map(({ source, transaction }) => ({
        id: transaction._id.toString(),
        type: source,
        transaction_type: this.getTransactionLabel(source),
        date: getEventDate(transaction) || null,
        postingDate: getPostingDate(transaction) || null,
        description: transaction.description ?? '',
        amount: roundAmount(Number(transaction.amount) || 0),
        status: transaction.status ?? '',
        companyId: transaction.companyId ?? null,
        category_id: transaction.category_id?.toString?.() ?? null,
        category: transaction.category || transaction.providerCategoryName || null,
        cardLast4: transaction.cardLast4 ?? transaction.cardNumber ?? null,
        counterparty: transaction.counterparty || null,
      }));

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
        start_date: args.start_date ?? null,
        end_date: args.end_date ?? null,
        category_id: category?._id?.toString?.() ?? null,
        category_name: category?.name ?? args.category_name ?? null,
        min_amount: minAmount,
        max_amount: maxAmount,
        sort_by: sortBy,
        sort_order: sortOrder,
      },
    };
  }

  private async getAccountOverviewForAgent(user_id: string): Promise<Record<string, unknown>> {
    const account = await bankLogic.fetchMainAccountResponse(user_id);
    const banks = account?.banks ?? [];
    const latestConnection = banks.reduce((latest, bank) => Math.max(latest, bank?.lastConnection || 0), 0);
    const mainAccount = banks.find((bank) => bank.isMainAccount) ?? null;
    const totalBalance = banks.reduce((sum, bank) => sum + (Number(bank?.details?.balance) || 0), 0);
    const totalSavings = banks.reduce((sum, bank) => sum + (Number(bank?.savings?.totalDepositsCurrentValue) || 0), 0);
    const totalLoanBalance = banks.reduce((sum, bank) => sum + (Number(bank?.loans?.summary?.totalBalance) || 0), 0);
    const currentMonthLoanPayments = banks.reduce((sum, bank) => sum + (Number(bank?.loans?.summary?.currentMonthTotalPayment) || 0), 0);

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
        id: mainAccount._id?.toString?.() ?? null,
        bankName: mainAccount.bankName,
        balance: roundAmount(Number(mainAccount?.details?.balance) || 0),
        accountNumber: mainAccount?.details?.accountNumber ?? null,
        lastConnection: mainAccount.lastConnection ? new Date(mainAccount.lastConnection).toISOString() : null,
        isCardProvider: mainAccount.isCardProvider,
      } : null,
      accounts: banks.map((bank) => ({
        id: bank._id?.toString?.() ?? null,
        bankName: bank.bankName,
        isMainAccount: !!bank.isMainAccount,
        isCardProvider: !!bank.isCardProvider,
        balance: roundAmount(Number(bank?.details?.balance) || 0),
        accountNumber: bank?.details?.accountNumber ?? null,
        lastConnection: bank.lastConnection ? new Date(bank.lastConnection).toISOString() : null,
        hasCredentials: !!bank.credentials,
        cardsCount: bank.cardsPastOrFutureDebit?.cardsBlock?.length ?? 0,
      })),
    };
  }

  private async getCreditCardSnapshotForAgent(user_id: string): Promise<Record<string, unknown>> {
    const account = await bankLogic.fetchMainAccountResponse(user_id);
    const banks = account?.banks ?? [];
    const cardProviders = banks.filter((bank) =>
      bank.isCardProvider || (bank.cardsPastOrFutureDebit?.cardsBlock?.length ?? 0) > 0,
    );

    const cards = cardProviders.flatMap((bank) =>
      (bank.cardsPastOrFutureDebit?.cardsBlock ?? []).map((card: AgentCardSnapshotSource) => ({
        providerId: bank._id?.toString?.() ?? null,
        providerName: bank.bankName,
        cardUniqueId: card.cardUniqueId ?? null,
        cardName: card.cardName ?? null,
        cardFamilyDescription: card.cardFamilyDescription ?? null,
        cardTypeDescription: card.cardTypeDescription ?? null,
        cardLast4: card.last4Digits || String(card.cardNumber ?? '').slice(-4) || null,
        holderName: [card.firstName, card.lastName].filter(Boolean).join(' ') || null,
        framework: roundAmount(Number(card.cardFramework) || 0),
        frameworkUsed: roundAmount(Number(card.cardFrameworkUsed) || 0),
        frameworkAvailable: roundAmount(
          Number(card.cardFrameworkNotUsed) || Math.max(0, (Number(card.cardFramework) || 0) - (Number(card.cardFrameworkUsed) || 0)),
        ),
        upcomingDebitDate: card.dateOfUpcomingDebit || null,
        upcomingDebitNIS: roundAmount(Number(card.NISTotalDebit) || 0),
        statusCode: card.cardStatusCode ?? null,
      })),
    );

    const upcomingDebitByDate = cards.reduce<Record<string, number>>((acc, card) => {
      if (!card.upcomingDebitDate) return acc;
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
  }

  private async detectSubscriptionPriceChangesForAgent(
    user_id: string,
    args: Record<string, any>,
  ): Promise<Record<string, unknown>> {
    const groups = await detectRecurringTransactions(user_id, { dateBasis: 'event' });
    const minChangeAmount = Math.abs(Number(args.min_change_amount) || 5);
    const minChangeRatio = Math.abs(Number(args.min_change_ratio) || 0.08);
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
    const includeDecreases = args.include_decreases !== false;

    const median = (values: number[]): number => {
      const sorted = [...values].sort((left, right) => left - right);
      if (sorted.length === 0) return 0;
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
    };

    const changes = groups
      .filter((group) => group.kind === 'expense')
      .filter((group) => ['monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual'].includes(String(group.frequency)))
      .filter((group) => (group.transactions?.length ?? 0) >= 3)
      .map((group) => {
        const orderedTransactions = [...(group.transactions ?? [])]
          .sort((left, right) => String(left.eventDate || left.postingDate || '').localeCompare(String(right.eventDate || right.postingDate || '')));
        const amounts = orderedTransactions.map((transaction) => Math.abs(Number(transaction.amount) || 0));
        const latestAmount = amounts[amounts.length - 1] ?? 0;
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
          source: group.source ?? null,
          frequency: group.frequency,
          classification: group.classification ?? null,
          latestAmount: roundAmount(latestAmount),
          previousMedian: roundAmount(previousMedian),
          previousAverage: roundAmount(previousAverage),
          changeAmount: roundAmount(changeAmount),
          changeRatio: roundAmount(changeRatio * 100),
          direction,
          lastSeen: orderedTransactions[orderedTransactions.length - 1]?.eventDate
            || orderedTransactions[orderedTransactions.length - 1]?.postingDate
            || null,
          previousSeen: orderedTransactions[orderedTransactions.length - 2]?.eventDate
            || orderedTransactions[orderedTransactions.length - 2]?.postingDate
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
  }

  private buildMonthlyRiskLevel(projectedMonthNet: number, referenceAmount: number): 'low' | 'medium' | 'high' {
    if (projectedMonthNet < 0) {
      return referenceAmount > 0 && Math.abs(projectedMonthNet) / referenceAmount > 0.1
        ? 'high'
        : 'medium';
    }

    return referenceAmount > 0 && projectedMonthNet / referenceAmount < 0.05 ? 'medium' : 'low';
  }

  private getReadOnlyToolDefinitions(): AgentToolDefinition[] {
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
        execute: async (args, context) => {
          const { merchant_name, month, year } = args;
          const { start, end } = this.getDateRange(month, year);
          const transactions = await this.getCardTransactionsInRange(context.user_id, start, end);
          const matcher = new RegExp(merchant_name, 'i');
          const matched = transactions.filter((transaction) => matcher.test(transaction.description || ''));
          const total = matched.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

          return {
            merchant: merchant_name,
            total: roundAmount(total),
            count: matched.length,
            period: formatDateWindow(start, end),
          };
        },
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
        execute: async (args, context) => {
          const { start, end } = this.getDateRange(args.month, args.year);
          const transactions = await this.getBankTransactionsInRange(context.user_id, start, end);
          const totalsByCategory: Record<string, { name: string; total: number; count: number }> = {};

          for (const transaction of transactions) {
            if (transaction.amount >= 0) continue;
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
            .map((entry) => ({ ...entry, total: roundAmount(entry.total) }));
        },
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
        execute: async (args, context) => {
          const { start, end } = this.getDateRange(args.month, args.year);
          const transactions = await this.getBankTransactionsInRange(context.user_id, start, end);

          let income = 0;
          let expenses = 0;
          for (const transaction of transactions) {
            if (transaction.amount > 0) income += transaction.amount;
            else expenses += Math.abs(transaction.amount);
          }

          return {
            period: formatDateWindow(start, end),
            income: roundAmount(income),
            expenses: roundAmount(expenses),
            net: roundAmount(income - expenses),
          };
        },
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
        execute: async (args, context) => {
          const { limit = 5, month, year } = args;
          const { start, end } = this.getDateRange(month, year);
          const transactions = await this.getCardTransactionsInRange(context.user_id, start, end);
          const byMerchant: Record<string, number> = {};

          for (const transaction of transactions) {
            if (transaction.amount >= 0) continue;
            const key = transaction.description || 'Unknown';
            byMerchant[key] = (byMerchant[key] || 0) + Math.abs(transaction.amount);
          }

          return Object.entries(byMerchant)
            .sort(([, left], [, right]) => right - left)
            .slice(0, limit)
            .map(([name, total]) => ({ name, total: roundAmount(total) }));
        },
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
        execute: async (args, context) => {
          const { merchant_name, limit = 10, start_date, end_date } = args;
          const transactionType = this.normalizeTransactionType(args.transaction_type);
          const now = new Date();
          const start = start_date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
          const end = end_date || now.toISOString().slice(0, 10);
          const [bankTransactions, cardTransactions] = await Promise.all([
            transactionType === 'creditCards'
              ? Promise.resolve([])
              : this.getBankTransactionsInRange(context.user_id, start, end),
            transactionType === 'transactions'
              ? Promise.resolve([])
              : this.getCardTransactionsInRange(context.user_id, start, end),
          ]);
          const matcher = merchant_name ? new RegExp(merchant_name, 'i') : null;
          const taggedTransactions: Array<{ source: TransactionCollectionType; transaction: AgentTransactionRecord }> = [
            ...bankTransactions.map((transaction) => ({ source: 'transactions' as TransactionCollectionType, transaction })),
            ...cardTransactions.map((transaction) => ({ source: 'creditCards' as TransactionCollectionType, transaction })),
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
              date: getEventDate(transaction),
              description: transaction.description,
              amount: transaction.amount,
            }));
        },
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
        execute: async (args, context) => this.searchTransactionsForAgent(context.user_id, args),
      },
      {
        name: 'get_account_overview',
        description: 'Get a summary of connected bank accounts, balances, main account, credentials, savings, and loan totals.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the account overview.',
        execute: async (_, context) => this.getAccountOverviewForAgent(context.user_id),
      },
      {
        name: 'get_credit_card_snapshot',
        description: 'Get a snapshot of connected credit cards, upcoming debits, and framework usage.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the credit card snapshot.',
        execute: async (_, context) => this.getCreditCardSnapshotForAgent(context.user_id),
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
        execute: async (args, context) => this.detectSubscriptionPriceChangesForAgent(context.user_id, args),
      },
      {
        name: 'get_financial_health_overview',
        description: 'Get the full financial health assessment for the user.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the financial health overview.',
        execute: async (_, context) => calculateFinancialHealth(context.user_id, context.language),
      },
      {
        name: 'get_cash_flow_projection',
        description: 'Get the current month cash flow projection and risk outlook.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the cash flow projection.',
        execute: async (_, context) => calculateCashFlowProjection(context.user_id),
      },
      {
        name: 'get_forecast_details',
        description: 'Get the current spending forecast and historical comparison.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the spending forecast.',
        execute: async (_, context) => calculateForecast(context.user_id, context.language),
      },
      {
        name: 'get_savings_goals_status',
        description: 'Get the list of savings goals and their progress.',
        mode: 'read',
        schema: { type: 'object', properties: {} },
        summarize: () => 'Review the savings goals.',
        execute: async (_, context) => {
          const goals = await savingsGoalsLogic.fetchGoals(context.user_id, context.language);
          const totalTarget = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
          const totalSaved = goals.reduce((sum, goal) => sum + goal.currentAmount, 0);
          return {
            totalGoals: goals.length,
            totalTarget: roundAmount(totalTarget),
            totalSaved: roundAmount(totalSaved),
            remaining: roundAmount(totalTarget - totalSaved),
            goals,
          };
        },
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
        execute: async (args, context) => {
          const groups = await detectRecurringTransactions(context.user_id, { dateBasis: 'event' });
          const filtered = groups
            .filter((group) => !args.kind || group.kind === args.kind)
            .filter((group) => !args.source || group.source === args.source)
            .filter((group) => !args.frequency || group.frequency === args.frequency);
          const limit = args.limit ?? 10;
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
        },
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
        execute: async (args, context) => {
          const { start, end } = this.getDateRange(args.month, args.year);
          const categoriesDoc = await Categories.findOne({ user_id: context.user_id }).exec();
          const categories: ICategoryModel[] = categoriesDoc?.categories ?? [];
          const activeBudgets = categories.filter((category) =>
            category.maximumSpentAllowed?.active && (category.maximumSpentAllowed?.maximumAmount ?? 0) > 0,
          );

          if (activeBudgets.length === 0) {
            return {
              period: formatDateWindow(start, end),
              summary: { activeBudgets: 0, overBudget: 0, warningBudgetCount: 0 },
              budgets: [],
            };
          }

          const expenses = await this.getUnifiedExpenseEntries(context.user_id, start, end);
          const spendByCategory = new Map<string, number>();
          for (const entry of expenses) {
            const key = entry.category_id || 'uncategorized';
            spendByCategory.set(key, (spendByCategory.get(key) ?? 0) + entry.amount);
          }

          const budgets: BudgetStatusItem[] = activeBudgets.map((category) => {
            const maximumSpentAllowed = category.maximumSpentAllowed;
            if (!maximumSpentAllowed) {
              throw new ClientError(500, 'Active budget is missing maximum spend settings.');
            }
            const spent = roundAmount(spendByCategory.get(category._id?.toString?.() ?? '') ?? 0);
            const limit = roundAmount(maximumSpentAllowed.maximumAmount);
            const usageRatio = limit > 0 ? spent / limit : 0;
            const remaining = roundAmount(limit - spent);
            const status: BudgetStatusItem['status'] = spent > limit ? 'over' : usageRatio >= 0.8 ? 'warning' : 'ok';

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
        },
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
        execute: async (args, context) => {
          const periodAEntries = await this.getUnifiedExpenseEntries(context.user_id, args.start_date_a, args.end_date_a);
          const periodBEntries = await this.getUnifiedExpenseEntries(context.user_id, args.start_date_b, args.end_date_b);

          const summarizePeriod = (entries: UnifiedExpenseEntry[]) => ({
            total: roundAmount(entries.reduce((sum, entry) => sum + entry.amount, 0)),
            count: entries.length,
          });

          const categoryTotals = (entries: UnifiedExpenseEntry[]) => {
            const result = new Map<string, { name: string; total: number }>();
            for (const entry of entries) {
              const key = entry.category_id || entry.categoryName || 'uncategorized';
              const current = result.get(key) ?? { name: entry.categoryName || 'Uncategorized', total: 0 };
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
            const left = periodACategories.get(key) ?? { name: 'Uncategorized', total: 0 };
            const right = periodBCategories.get(key) ?? { name: left.name, total: 0 };
            const delta = left.total - right.total;
            return {
              category: left.name || right.name,
              period_a: roundAmount(left.total),
              period_b: roundAmount(right.total),
              delta: roundAmount(delta),
              deltaPct: right.total > 0 ? roundAmount((delta / right.total) * 100) : null,
            };
          }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
            .slice(0, args.top_n ?? 5);

          const totalDelta = periodA.total - periodB.total;
          return {
            period_a: { start: args.start_date_a, end: args.end_date_a, ...periodA },
            period_b: { start: args.start_date_b, end: args.end_date_b, ...periodB },
            delta: roundAmount(totalDelta),
            deltaPct: periodB.total > 0 ? roundAmount((totalDelta / periodB.total) * 100) : null,
            top_category_changes: topChanges,
          };
        },
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
        execute: async (args, context) => {
          const now = new Date();
          const targetMonth = args.month ?? now.getMonth() + 1;
          const targetYear = args.year ?? now.getFullYear();
          const lookbackMonths = args.lookback_months ?? 6;
          const targetRange = this.getDateRange(targetMonth, targetYear);
          const historicalStartCursor = addMonths(targetYear, targetMonth, -lookbackMonths);
          const historicalStart = startOfMonth(historicalStartCursor.year, historicalStartCursor.month);
          const historicalEndCursor = addMonths(targetYear, targetMonth, -1);
          const historicalEnd = endOfMonth(historicalEndCursor.year, historicalEndCursor.month);

          const [targetEntries, historicalEntries] = await Promise.all([
            this.getUnifiedExpenseEntries(context.user_id, targetRange.start, targetRange.end),
            lookbackMonths > 0
              ? this.getUnifiedExpenseEntries(context.user_id, historicalStart, historicalEnd)
              : Promise.resolve([]),
          ]);

          const targetByMerchant = new Map<string, { name: string; total: number; count: number }>();
          for (const entry of targetEntries) {
            const key = entry.normalizedDescription || entry.description || 'unknown';
            const current = targetByMerchant.get(key) ?? { name: entry.description || 'Unknown', total: 0, count: 0 };
            current.total += entry.amount;
            current.count += 1;
            targetByMerchant.set(key, current);
          }

          const historicalByMerchantMonth = new Map<string, Map<string, number>>();
          for (const entry of historicalEntries) {
            const merchantKey = entry.normalizedDescription || entry.description || 'unknown';
            const monthKey = entry.date.slice(0, 7);
            const current = historicalByMerchantMonth.get(merchantKey) ?? new Map<string, number>();
            current.set(monthKey, (current.get(monthKey) ?? 0) + entry.amount);
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
          }).filter((item) =>
            item.currentTotal >= 100 &&
            (item.isNewMerchant || (item.historicalAverage > 0 && item.currentTotal >= item.historicalAverage * 1.5)),
          ).sort((left, right) => right.increaseAmount - left.increaseAmount)
            .slice(0, args.limit ?? 5);

          return {
            targetPeriod: formatDateWindow(targetRange.start, targetRange.end),
            lookbackMonths,
            anomalies,
          };
        },
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
        execute: async (args, context) => {
          const baseline = await calculateCashFlowProjection(context.user_id);
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
          const riskLevel = this.buildMonthlyRiskLevel(
            projectedMonthNet,
            Math.max(baseline.incomeToDate, baseline.expensesToDate, 1),
          );

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
        },
      },
    ];
  }

  private getMutationToolDefinitions(): AgentToolDefinition[] {
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
        execute: async (args, context) => {
          const goal = await savingsGoalsLogic.addGoal(context.user_id, {
            name: args.name,
            targetAmount: Number(args.target_amount),
            currentAmount: Number(args.current_amount ?? 0),
            targetDate: args.target_date,
          });

          return {
            goal_id: goal._id?.toString?.() ?? '',
            name: goal.name,
            targetAmount: goal.targetAmount,
          };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Created the savings goal **${result.name || args.name}** with a target of **₪${roundAmount(result.targetAmount || args.target_amount)}**.`,
          `יצרתי את יעד החיסכון **${result.name || args.name}** עם יעד של **₪${roundAmount(result.targetAmount || args.target_amount)}**.`,
        ),
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
        execute: async (args, context) => {
          const goal = await this.getSavingsGoalById(context.user_id, args.goal_id);
          goal.name = args.name ?? goal.name;
          goal.targetAmount = args.target_amount ?? goal.targetAmount;
          goal.currentAmount = args.current_amount ?? goal.currentAmount;
          goal.targetDate = args.target_date ?? goal.targetDate;
          const updated = await savingsGoalsLogic.updateGoal(context.user_id, goal);

          return {
            goal_id: updated._id?.toString?.() ?? args.goal_id,
            name: updated.name,
          };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Updated the savings goal **${result.name || args.goal_id}**.`,
          `עדכנתי את יעד החיסכון **${result.name || args.goal_id}**.`,
        ),
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
        execute: async (args, context) => {
          const existingGoal = await this.getSavingsGoalById(context.user_id, args.goal_id);
          const goalName = existingGoal.name;
          await savingsGoalsLogic.removeGoal(context.user_id, args.goal_id);
          return { goal_id: args.goal_id, name: goalName };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Deleted the savings goal **${result.name || args.goal_id}**.`,
          `מחקתי את יעד החיסכון **${result.name || args.goal_id}**.`,
        ),
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
        execute: async (args, context) => {
          const category = await categoriesLogic.addNewCategory(args.name, context.user_id);
          return {
            category_id: category._id?.toString?.() ?? '',
            name: category.name,
          };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Created the category **${result.name || args.name}**.`,
          `יצרתי את הקטגוריה **${result.name || args.name}**.`,
        ),
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
        execute: async (args, context) => {
          const category = await this.resolveCategory(context.user_id, {
            category_id: args.category_id,
            category_name: args.category_name,
          });
          const existingWithNewName = await categoriesLogic.fetchUserCategory(context.user_id, args.new_name);
          if (existingWithNewName && existingWithNewName._id.toString() !== category._id.toString()) {
            throw new ClientError(409, 'Category name is already in use.');
          }

          category.name = args.new_name;
          const updated = await categoriesLogic.updateCategory(category, context.user_id);

          return {
            category_id: updated._id?.toString?.() ?? category._id.toString(),
            name: updated.name,
          };
        },
        buildResultReply: (args, result, language) => localize(
          language,
          `Renamed the category to **${result.name || args.new_name}**.`,
          `שיניתי את שם הקטגוריה ל-**${result.name || args.new_name}**.`,
        ),
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
        execute: async (args, context) => {
          const category = await this.resolveCategory(context.user_id, {
            category_id: args.category_id,
            category_name: args.category_name,
          });
          category.maximumSpentAllowed = {
            active: args.active ?? true,
            maximumAmount: Number(args.maximum_amount),
          };
          const updated = await categoriesLogic.updateCategory(category, context.user_id);

          return {
            category_id: updated._id?.toString?.() ?? category._id.toString(),
            name: updated.name,
            maximumAmount: updated.maximumSpentAllowed?.maximumAmount ?? Number(args.maximum_amount),
          };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Updated the budget for **${result.name}** to **₪${roundAmount(result.maximumAmount)}**.`,
          `עדכנתי את התקציב של **${result.name}** ל-**₪${roundAmount(result.maximumAmount)}**.`,
        ),
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
        execute: async (args, context) => {
          const updated = await overridePattern(context.user_id, args.pattern_id, { confirmed: true });
          if (!updated) throw new ClientError(404, 'Recurring pattern not found.');
          return { pattern_id: args.pattern_id };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Confirmed the recurring pattern **${result.pattern_id}**.`,
          `אישרתי את הדפוס החוזר **${result.pattern_id}**.`,
        ),
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
        execute: async (args, context) => {
          const updated = await overridePattern(context.user_id, args.pattern_id, { disabled: true });
          if (!updated) throw new ClientError(404, 'Recurring pattern not found.');
          return { pattern_id: args.pattern_id };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Disabled the recurring pattern **${result.pattern_id}**.`,
          `נטרלתי את הדפוס החוזר **${result.pattern_id}**.`,
        ),
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
        execute: async (args, context) => {
          const patch: Partial<{
            confirmed: boolean;
            disabled: boolean;
            customAmount: number;
            customFrequency: string;
            customClassification: PatternClass;
          }> = {};
          if (args.custom_amount !== undefined) patch.customAmount = Number(args.custom_amount);
          if (args.custom_frequency !== undefined) patch.customFrequency = String(args.custom_frequency);
          if (args.custom_classification !== undefined) patch.customClassification = String(args.custom_classification) as PatternClass;
          if (args.confirmed !== undefined) patch.confirmed = Boolean(args.confirmed);
          if (args.disabled !== undefined) patch.disabled = Boolean(args.disabled);
          if (Object.keys(patch).length === 0) {
            throw new ClientError(400, 'No recurring override fields were provided.');
          }

          const updated = await overridePattern(context.user_id, args.pattern_id, patch);
          if (!updated) throw new ClientError(404, 'Recurring pattern not found.');
          return { pattern_id: args.pattern_id };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Updated the recurring pattern **${result.pattern_id}**.`,
          `עדכנתי את הדפוס החוזר **${result.pattern_id}**.`,
        ),
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
        execute: async (args, context) => {
          const category = await this.resolveCategory(context.user_id, {
            category_id: args.category_id,
            category_name: args.category_name,
          });
          const { transaction, type } = await this.resolveTransaction(context.user_id, args.transaction_id, args.transaction_type);
          transaction.category_id = category._id as MainTransactionType['category_id'];
          const updated = await transactionsLogic.updateTransaction(context.user_id, transaction, type);

          return {
            transaction_id: updated._id?.toString?.() ?? args.transaction_id,
            category_name: category.name,
            description: updated.description,
          };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Reassigned **${result.description || 'the transaction'}** to **${result.category_name}**.`,
          `שיייכתי מחדש את **${result.description || 'העסקה'}** ל-**${result.category_name}**.`,
        ),
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
        execute: async (args, context) => {
          const { transaction, type } = await this.resolveTransaction(context.user_id, args.transaction_id, args.transaction_type);
          const updatedCategory = args.category_id || args.category_name
            ? await this.resolveCategory(context.user_id, { category_id: args.category_id, category_name: args.category_name })
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
            throw new ClientError(400, 'No transaction update fields were provided.');
          }

          transaction.description = args.description ?? transaction.description;
          transaction.amount = args.amount ?? transaction.amount;
          transaction.eventDate = args.event_date ?? transaction.eventDate;
          transaction.postingDate = args.posting_date ?? transaction.postingDate;
          transaction.date = args.event_date ?? transaction.date ?? transaction.eventDate;
          transaction.processedDate = args.posting_date ?? transaction.processedDate ?? transaction.postingDate;
          if (updatedCategory?._id) {
            transaction.category_id = updatedCategory._id as MainTransactionType['category_id'];
          }

          const updated = await transactionsLogic.updateTransaction(context.user_id, transaction, type);

          return {
            transaction_id: updated._id?.toString?.() ?? args.transaction_id,
            description: updated.description,
            amount: updated.amount,
          };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Updated **${result.description || 'the transaction'}** to **₪${roundAmount(result.amount)}**.`,
          `עדכנתי את **${result.description || 'העסקה'}** ל-**₪${roundAmount(result.amount)}**.`,
        ),
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
        execute: async (args, context) => {
          const bank = await bankLogic.fetchOneBankAccount(context.user_id, args.bank_id);
          if (!bank) throw new ClientError(404, 'Bank account not found.');
          const refreshed = await bankLogic.refreshBankData(args.bank_id, context.user_id);
          return {
            bank_id: args.bank_id,
            bank_name: bank.bankName || bank.details?.accountNumber || args.bank_id,
            importedTransactions: refreshed.importedTransactions?.length ?? 0,
          };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Refreshed **${result.bank_name}** and imported **${result.importedTransactions}** transactions.`,
          `רעננתי את **${result.bank_name}** וייבאתי **${result.importedTransactions}** עסקאות.`,
        ),
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
        execute: async (args, context) => {
          const bank = await bankLogic.fetchOneBankAccount(context.user_id, args.bank_id);
          if (!bank) throw new ClientError(404, 'Bank account not found.');
          await bankLogic.setMainBankAccount(context.user_id, args.bank_id);
          return {
            bank_id: args.bank_id,
            bank_name: bank.bankName || bank.details?.accountNumber || args.bank_id,
          };
        },
        buildResultReply: (_, result, language) => localize(
          language,
          `Set **${result.bank_name}** as the main bank account.`,
          `הגדרתי את **${result.bank_name}** כחשבון הבנק הראשי.`,
        ),
      },
    ];
  }

  private getToolDefinitions(): AgentToolDefinition[] {
    return [
      ...this.getReadOnlyToolDefinitions(),
      ...this.getMutationToolDefinitions(),
    ];
  }
}

export type { ChatMessage, PendingActionView, AgentChatResponse, HistoryResponse };
export default new AgentChatLogic();
