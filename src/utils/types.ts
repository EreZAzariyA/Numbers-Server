import { ICardTransactionModel, ITransactionModel } from "../models";

export type GoogleUserType = {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  email: string;
  email_verified: boolean;
  locale: string;
};

export type EmailType = {
  email: string,
  isValidate: boolean,
  isActive: boolean
};

export type MainTransactionType = ITransactionModel | ICardTransactionModel;

export type PatternClass =
  | 'subscription'
  | 'installment_plan'
  | 'fixed_income'
  | 'variable_income'
  | 'fixed_expense'
  | 'variable_expense'
  | 'one_time';

export type Frequency =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'unknown'
  | 'irregular';

export type AnchorKind = 'dayOfMonth' | 'dayOfWeek' | 'businessDay';

export interface PatternAnchor {
  kind: AnchorKind;
  value: number;
  stddevDays: number;
}

export interface InstallmentPlanSummary {
  paymentsRemaining: number;
  totalPayments: number;
  monthlyAmount?: number;
  expectedLastPaymentDate?: string;
}

export interface RecurringTransactionItem {
  _id: string;
  date: string;
  processedDate: string;
  amount: number;
  description: string;
  companyId: string;
  kind: 'income' | 'expense';
}

export interface RecurringGroup {
  description: string;
  normalizedDescription: string;
  kind: 'income' | 'expense';
  amount: number;
  frequency: 'monthly' | 'weekly' | 'irregular' | Frequency;
  occurrences: number;
  nextExpected: string | null;
  totalSpent: number;
  transactions: RecurringTransactionItem[];
  // --- Additive fields (optional for backwards compat) ---
  patternId?: string;
  classification?: PatternClass;
  confidence?: number;
  anchor?: PatternAnchor;
  installmentPlan?: InstallmentPlanSummary | null;
  userOverride?: { confirmed: boolean; disabled: boolean } | null;
  merchantKey?: string;
  source?: 'bank' | 'card';
}

export interface MonthlySpend {
  month: string;  // "YYYY-MM"
  amount: number;
}

export interface ForecastResponse {
  historicalMonths: MonthlySpend[];
  currentMonthSpend: number;
  forecastAmount: number;
  averageMonthlySpend: number;
  daysRemaining: number;
  aiInsight: string;
  trend: 'up' | 'down' | 'flat';
}

export interface ComponentResult {
  score: number;
  status: 'good' | 'warning' | 'bad' | 'neutral';
  detail: string;
}

export interface FinancialHealthResponse {
  score: number;
  status: 'good' | 'warning' | 'bad';
  components: {
    cashFlow: ComponentResult;
    categoryBudgets: ComponentResult;
    savingsTrend: ComponentResult;
    debtPressure: ComponentResult;
  };
  aiInsight: string;
}

export interface ProjectedEvent {
  description: string;
  amount: number;
  expectedDate: string;
  type: 'income' | 'expense';
  alreadyReceived: boolean;
  // --- Additive fields (optional for backwards compat) ---
  status?: 'pending' | 'realized' | 'missed';
  confidence?: number;
  merchantKey?: string;
  classification?: PatternClass;
  patternId?: string;
  source?: 'bank' | 'card';
}

export interface SettlementSummary {
  bankPending: number;
  cardPending: number;
  cardSettlementByDate: Record<string, number>;
}

export interface CashFlowProjectionResponse {
  incomeToDate: number;
  expensesToDate: number;
  netToDate: number;
  expectedEvents: ProjectedEvent[];
  projectedMonthNet: number;
  projectedEndBalance: number | null;
  currentBalance: number | null;
  riskLevel: 'low' | 'medium' | 'high';
  daysRemaining: number;
  // --- Additive fields (optional for backwards compat) ---
  settlement?: SettlementSummary;
  patternsAsOf?: string;
  missedEvents?: ProjectedEvent[];
}
