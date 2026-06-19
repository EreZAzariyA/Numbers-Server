import { Content, GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  AgentPendingActions,
  CardTransactions,
  Categories,
  ChatHistory,
  SavingsGoals,
  Transactions,
} from '../collections';
import type { IAgentPendingActionCollection, PendingAgentActionStatus } from '../collections/AgentPendingActions';
import bankLogic from './banks';
import { normalize } from './recurring/normalization';
import { detectRecurringTransactions } from './transactions';
import { ClientError } from '../models';
import type { ICategoryModel } from '../models';
import type { ISavingsGoalModel } from '../models/savings-goal-model';
import { socketIo } from '../dal/socket';
import { buildSettlementTreatmentMap } from '../utils/settlement-detection';
import type { MainTransactionType } from '../utils/types';
import { getEventDate, getPostingDate, getTransactionAmount, getTransactionTextSource } from '../utils/transaction-semantics';
import { getAiRateLimitMessage } from '../utils/ai-provider';
import { createOllamaClient } from '../utils/ollama-client';
import aiSettingsLogic from './ai-settings';
import { filterAndTallySettlements } from './shared/settlement-filter';
import { fetchCompletedTransactions } from './shared/transaction-queries';
import {
  AgentToolDefinition,
  AgentTransactionRecord,
  ToolExecutionContext,
  PendingActionView,
  SupportedLanguage,
  TransactionCollectionType,
  AgentTransactionFilterType,
  AgentTransactionLabel,
  UnifiedExpenseEntry,
} from './agent/tool-types';
import { toGeminiSchema, toOpenAISchema } from './agent/tool-schema';
import {
  roundAmount,
  startOfMonth,
  endOfMonth,
  buildInclusiveDateRangeFilter,
  localize,
} from './agent/tool-helpers';
import { createReadOnlyTools } from './agent/read-tools';
import { createMutationTools } from './agent/mutation-tools';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type AgentChatResponse = {
  reply: string;
  pendingAction?: PendingActionView | null;
};

type HistoryResponse = {
  messages: ChatMessage[];
  pendingAction?: PendingActionView | null;
};


type AgentProgressEvent = {
  requestId: string;
  step: string;
  label: string;
  status: 'active' | 'complete' | 'error';
  at: string;
  tool?: string;
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


const toProgressStepId = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

class AgentChatLogic {
  private _readOnlyTools?: AgentToolDefinition[];
  private _mutationTools?: AgentToolDefinition[];

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
    const stagedActionRef = { value: null as PendingActionView | null };
    const createToolUsageRef = () => ({
      names: [] as string[],
      usedAnyTool: false,
      usedReadTool: false,
    });
    const shouldRequireGroundedData = this.shouldRequireGroundedData(message);

    const systemInstruction = `You are a personal finance assistant for an Israeli finance app.
Always respond in ${normalizedLanguage === 'he' ? 'Hebrew' : 'English'}.
When the user asks about their finances, use the provided tools to look up real data before answering — never guess at amounts, balances, dates, or categories.
For greetings or small talk (e.g. "hi", "thanks"), reply directly and do not call any tool.
For big-picture or "how am I doing" questions about overall finances, call get_financial_overview first to load context.
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
Use ₪ for amounts. Today's date is ${today}.`;
    const strictSystemInstruction = `${systemInstruction}
For the user's latest request, you must call at least one relevant read tool before answering.
If you cannot verify the answer from a tool result, say that you could not verify it from live finance data and do not guess.`;

    try {
      emitProgress('consulting-assistant');
      let toolUsageRef = createToolUsageRef();
      let reply = await this.dispatchToProvider(
        systemInstruction,
        updatedHistory,
        user_id,
        normalizedLanguage,
        stagedActionRef,
        runtime,
        toolUsageRef,
        emitProgress,
        false,
      );

      if (shouldRequireGroundedData && !toolUsageRef.usedReadTool) {
        emitProgress('consulting-assistant');
        toolUsageRef = createToolUsageRef();
        reply = await this.dispatchToProvider(
          strictSystemInstruction,
          updatedHistory,
          user_id,
          normalizedLanguage,
          stagedActionRef,
          runtime,
          toolUsageRef,
          emitProgress,
          true,
        );
      }

      if (shouldRequireGroundedData && !toolUsageRef.usedReadTool) {
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

    const englishRetrievalIntent = /\b(list|show|what|which|when|find|search|compare|total|how much|give me|tell me|overview|summary|forecast|project|projection|how am i doing)\b/i;
    const englishFinanceDataTopic = /\b(transaction|transactions|spent|spend|expense|expenses|income|merchant|merchants|date|dates|balance|balances|category|categories|budget|budgets|card|cards|bank|banks|payment|payments|cash flow|financial health|subscription|subscriptions|recurring|renewal|renewals|saving|savings|goal|goals|wolt)\b/i;
    const hebrewRetrievalIntent = /(רשימה|רשימת|הצג|תראה|הראה|מה|איזה|אילו|מתי|חפש|מצא|השווה|סך|כמה|תן|תגיד|ספר|סקירה|סיכום|תחזית|מצב)/i;
    const hebrewFinanceDataTopic = /(עסקה|עסקאות|הוצאה|הוצאות|הכנסה|הכנסות|סכום|סכומים|בית עסק|סוחר|תשלום|תשלומים|יתרה|יתרות|קטגוריה|קטגוריות|תקציב|תקציבים|כרטיס|כרטיסים|אשראי|בנק|בנקים|חשבון|חשבונות|תזרים|בריאות פיננסית|מנוי|מנויים|חידוש|חידושים|חוזר|חוזרות|חיסכון|חסכונות|יעד|יעדים|וולט|wolt)/i;

    return (
      englishRetrievalIntent.test(normalizedMessage) && englishFinanceDataTopic.test(normalizedMessage)
    ) || (
      hebrewRetrievalIntent.test(normalizedMessage) && hebrewFinanceDataTopic.test(normalizedMessage)
    );
  }

  private formatToolDisplayName(name?: string): string {
    if (!name) return 'finance data';
    return String(name)
      .replace(/[_-]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  public normalizeTransactionType(type?: string | null): AgentTransactionFilterType {
    const normalizedType = String(type ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, '-');

    if (!normalizedType) return 'all';
    return TRANSACTION_TYPE_ALIASES[normalizedType] ?? 'all';
  }

  public getTransactionLabel(type: TransactionCollectionType): AgentTransactionLabel {
    return type === 'creditCards' ? 'card-transactions' : 'account-transactions';
  }

  private dispatchToProvider(
    systemInstruction: string,
    messages: ChatMessage[],
    user_id: string,
    language: SupportedLanguage,
    stagedActionRef: { value: PendingActionView | null },
    runtime: Awaited<ReturnType<typeof aiSettingsLogic.resolveProvider>>,
    toolUsageRef: NonNullable<ToolExecutionContext['toolUsageRef']>,
    emitProgress: ToolExecutionContext['emitProgress'] | undefined,
    strict: boolean,
  ): Promise<string> {
    if (runtime.provider === 'ollama') {
      return this.chatWithOllama(
        systemInstruction,
        messages,
        user_id,
        language,
        stagedActionRef,
        runtime.model!,
        toolUsageRef,
        emitProgress,
        strict,
        runtime.thinking,
      );
    }

    if (runtime.provider === 'claude') {
      return this.chatWithClaude(
        systemInstruction,
        messages,
        user_id,
        language,
        stagedActionRef,
        runtime,
        toolUsageRef,
        emitProgress,
        strict,
      );
    }

    return this.chatWithGemini(
      systemInstruction,
      messages,
      user_id,
      language,
      stagedActionRef,
      runtime,
      toolUsageRef,
      emitProgress,
      strict,
    );
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
    readOnlyToolsOnly = false,
  ): Promise<string> {
    const availableTools = readOnlyToolsOnly ? this.getReadOnlyToolDefinitions() : this.getToolDefinitions();
    const genAI = new GoogleGenerativeAI(runtime.apiKey!);
    const model = genAI.getGenerativeModel({
      model: runtime.model!,
      systemInstruction,
      tools: [{ functionDeclarations: this.getGeminiTools(availableTools) }],
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
    thinkingEnabled = true,
  ): Promise<string> {
    const client = createOllamaClient();

    // Reasoning models (e.g. Qwen3) emit a long hidden chain-of-thought before
    // answering. The `/no_think` directive disables it for much lower latency.
    const effectiveSystemInstruction = thinkingEnabled ? systemInstruction : `/no_think\n${systemInstruction}`;

    const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: effectiveSystemInstruction },
      ...messages.map((message) => ({
        role: (message.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: message.content,
      })),
    ];

    const availableTools = forceToolUse ? this.getReadOnlyToolDefinitions() : this.getToolDefinitions();
    const openAiTools = this.getOpenAITools(availableTools);
    const send = (extra: Partial<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming> = {}) =>
      client.chat.completions.create({
        model,
        messages: history,
        tools: openAiTools,
        ...extra,
      });

    let response = await send(forceToolUse ? { tool_choice: 'required' } : {});

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
      response = await send();
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
    readOnlyToolsOnly = false,
  ): Promise<string> {
    const availableTools = readOnlyToolsOnly ? this.getReadOnlyToolDefinitions() : this.getToolDefinitions();
    const client = new Anthropic({ apiKey: runtime.apiKey! });
    const history: any[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const tools = this.getAnthropicTools(availableTools);
    const send = () => client.messages.create({
      model: runtime.model!,
      max_tokens: 1200,
      system: systemInstruction,
      messages: history,
      tools,
    });

    let response = await send();

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
      response = await send();
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

  private getGeminiTools(definitions: AgentToolDefinition[] = this.getToolDefinitions()): any[] {
    return definitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      parameters: toGeminiSchema(definition.schema),
    }));
  }

  private getOpenAITools(definitions: AgentToolDefinition[] = this.getToolDefinitions()): OpenAI.Chat.ChatCompletionTool[] {
    return definitions.map((definition) => ({
      type: 'function',
      function: {
        name: definition.name,
        description: definition.description,
        parameters: toOpenAISchema(definition.schema),
      },
    }));
  }

  private getAnthropicTools(definitions: AgentToolDefinition[] = this.getToolDefinitions()): any[] {
    return definitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      input_schema: toOpenAISchema(definition.schema),
    }));
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

  private buildInactiveActionMessage(status: PendingAgentActionStatus, language: SupportedLanguage): string {
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

  public getDateRange(month?: number, year?: number): { start: string; end: string } {
    const now = new Date();
    const normalizedMonth = month ?? now.getMonth() + 1;
    const normalizedYear = year ?? now.getFullYear();
    return {
      start: startOfMonth(normalizedYear, normalizedMonth),
      end: endOfMonth(normalizedYear, normalizedMonth),
    };
  }

  public async getBankTransactionsInRange(user_id: string, start: string, end: string) {
    return Transactions.find({ user_id, eventDate: buildInclusiveDateRangeFilter(start, end) }).lean().exec();
  }

  public async getCardTransactionsInRange(user_id: string, start: string, end: string) {
    return CardTransactions.find({ user_id, eventDate: buildInclusiveDateRangeFilter(start, end) }).lean().exec();
  }

  private async getCompletedTransactionsInRange(user_id: string, start: string, end: string) {
    const { regularTxns, cardTxns } = await fetchCompletedTransactions(user_id, {
      eventDate: buildInclusiveDateRangeFilter(start, end),
    });
    return {
      regularTxns: regularTxns as AgentTransactionRecord[],
      cardTxns: cardTxns as AgentTransactionRecord[],
    };
  }

  public async getUnifiedExpenseEntries(user_id: string, start: string, end: string): Promise<UnifiedExpenseEntry[]> {
    const { regularTxns, cardTxns } = await this.getCompletedTransactionsInRange(user_id, start, end);
    const hasCardData = cardTxns.length > 0;
    const settlementTreatments = buildSettlementTreatmentMap(regularTxns, cardTxns);
    const dataQuality = {
      lowConfidenceSettlementCount: 0,
      lowConfidenceSettlementSpend: 0,
    };

    const expenses = [...regularTxns, ...cardTxns]
      .map((transaction) => ({ transaction, amount: getTransactionAmount(transaction) }))
      .filter(({ amount }) => amount < 0);

    return filterAndTallySettlements(
      expenses,
      settlementTreatments,
      hasCardData,
      {
        id: ({ transaction }) => transaction._id?.toString?.() ?? '',
        text: ({ transaction }) => getTransactionTextSource(transaction),
        amount: ({ amount }) => amount,
      },
      dataQuality,
    ).map(({ transaction, amount }) => ({
        amount: Math.abs(amount),
        category_id: transaction.category_id?.toString?.() ?? '',
        categoryName: transaction.category || transaction.providerCategoryName || 'Uncategorized',
        description: transaction.description ?? '',
        normalizedDescription: normalize(transaction.description ?? ''),
        date: getPostingDate(transaction) || getEventDate(transaction),
      }));
  }

  public async resolveCategory(
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

  public async resolveTransaction(
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

  public async getSavingsGoalById(user_id: string, goalId: string): Promise<ISavingsGoalModel> {
    const doc = await SavingsGoals.findOne({ user_id, 'goals._id': goalId }).exec();
    const goal = doc?.goals?.find((item) => item._id.toString() === goalId);
    if (!goal) {
      throw new ClientError(404, 'Savings goal not found.');
    }
    return goal;
  }

  public async searchTransactionsForAgent(
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

  public async getAccountOverviewForAgent(user_id: string): Promise<Record<string, unknown>> {
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

  public async getCreditCardSnapshotForAgent(user_id: string): Promise<Record<string, unknown>> {
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

  public async detectSubscriptionPriceChangesForAgent(
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

  public buildMonthlyRiskLevel(projectedMonthNet: number, referenceAmount: number): 'low' | 'medium' | 'high' {
    if (projectedMonthNet < 0) {
      return referenceAmount > 0 && Math.abs(projectedMonthNet) / referenceAmount > 0.1
        ? 'high'
        : 'medium';
    }

    return referenceAmount > 0 && projectedMonthNet / referenceAmount < 0.05 ? 'medium' : 'low';
  }

  private getReadOnlyToolDefinitions(): AgentToolDefinition[] {
    return this._readOnlyTools ??= createReadOnlyTools(this);
  }

  private getMutationToolDefinitions(): AgentToolDefinition[] {
    return this._mutationTools ??= createMutationTools(this);
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
