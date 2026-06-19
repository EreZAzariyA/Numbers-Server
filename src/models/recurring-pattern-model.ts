import { Document, Types } from 'mongoose';
import { PatternClass, Frequency, AnchorKind } from '../utils/types';

interface IRecurringPatternAnchor {
  kind: AnchorKind;
  value: number;
  stddevDays: number;
}

interface IRecurringPatternAmount {
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  currency: string;
  isFx: boolean;
}

interface IRecurringPatternInstallmentPlan {
  paymentsRemaining: number;
  totalPayments: number;
  monthlyAmount: number;
  expectedLastPaymentDate: string;
}

interface IRecurringPatternObserved {
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  missedInLast6Cycles: number;
  occurrenceTxIds: string[];
}

interface IRecurringPatternSignals {
  companyIds: string[];
  categoryIds: string[];
  channels: string[];
  descriptionVariants: string[];
  memoVariants: string[];
}

interface IRecurringPatternUserOverride {
  confirmed: boolean;
  disabled: boolean;
  customAmount?: number;
  customFrequency?: string;
  customClassification?: string;
}

export interface IRecurringPatternModel extends Document {
  user_id: Types.ObjectId;
  merchantKey: string;
  source: 'bank' | 'card';

  classification: PatternClass;
  kind: 'income' | 'expense';
  frequency: Frequency;

  anchor: IRecurringPatternAnchor;

  amount: IRecurringPatternAmount;

  installmentPlan: IRecurringPatternInstallmentPlan | null;

  observed: IRecurringPatternObserved;

  confidence: number;
  stability: number;

  signals: IRecurringPatternSignals;

  userOverride: IRecurringPatternUserOverride | null;

  updatedAt: Date;
  createdAt: Date;
}
