import type { ICategoryModel } from '../../models';
import type { ISavingsGoalModel } from '../../models/savings-goal-model';
import type { MainTransactionType } from '../../utils/types';

type ToolMode = 'read' | 'mutate';
export type SupportedLanguage = 'en' | 'he';
export type TransactionCollectionType = 'transactions' | 'creditCards';
export type AgentTransactionFilterType = 'all' | TransactionCollectionType;
export type AgentTransactionLabel = 'account-transactions' | 'card-transactions';

export type ToolSchemaProperty = {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolSchemaProperty>;
  required?: string[];
  items?: ToolSchemaProperty;
};

export type ToolSchema = {
  type: 'object';
  properties: Record<string, ToolSchemaProperty>;
  required?: string[];
};

export type PendingActionView = {
  id: string;
  tool: string;
  summary: string;
  argsPreview: Record<string, unknown>;
  expiresAt: string;
};

export type ToolExecutionContext = {
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

export type AgentToolDefinition = {
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

export type AgentTransactionRecord = {
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

export type UnifiedExpenseEntry = {
  amount: number;
  category_id?: string;
  categoryName?: string;
  description: string;
  normalizedDescription: string;
  date: string;
};

export type BudgetStatusItem = {
  category_id: string;
  name: string;
  spent: number;
  limit: number;
  remaining: number;
  usageRatio: number;
  status: 'ok' | 'warning' | 'over';
};

// The subset of AgentChatLogic that tool `execute` closures call. The class
// implements this structurally and is passed into the tool factories as `host`.
export interface ToolHost {
  getDateRange(month?: number, year?: number): { start: string; end: string };
  getBankTransactionsInRange(user_id: string, start: string, end: string): Promise<any[]>;
  getCardTransactionsInRange(user_id: string, start: string, end: string): Promise<any[]>;
  getUnifiedExpenseEntries(user_id: string, start: string, end: string): Promise<UnifiedExpenseEntry[]>;
  resolveCategory(user_id: string, options: { category_id?: string; category_name?: string }): Promise<ICategoryModel>;
  resolveTransaction(
    user_id: string,
    transactionId: string,
    type?: string,
  ): Promise<{ transaction: MainTransactionType; type: TransactionCollectionType }>;
  getSavingsGoalById(user_id: string, goalId: string): Promise<ISavingsGoalModel>;
  searchTransactionsForAgent(
    user_id: string,
    args: Record<string, any>,
  ): Promise<{
    totalMatches: number;
    transactions: Array<Record<string, unknown>>;
    appliedFilters: Record<string, unknown>;
  }>;
  normalizeTransactionType(type?: string | null): AgentTransactionFilterType;
  getTransactionLabel(type: TransactionCollectionType): AgentTransactionLabel;
  getAccountOverviewForAgent(user_id: string): Promise<Record<string, unknown>>;
  getCreditCardSnapshotForAgent(user_id: string): Promise<Record<string, unknown>>;
  detectSubscriptionPriceChangesForAgent(user_id: string, args: Record<string, any>): Promise<Record<string, unknown>>;
  buildMonthlyRiskLevel(projectedMonthNet: number, referenceAmount: number): 'low' | 'medium' | 'high';
}
