import { model, Schema } from 'mongoose';
import { IRecurringPatternModel } from '../models/recurring-pattern-model';

const RecurringPatternsSchema = new Schema<IRecurringPatternModel>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  merchantKey: {
    type: String,
    required: true,
    trim: true,
  },
  source: {
    type: String,
    enum: ['bank', 'card'],
    default: 'bank',
  },

  classification: {
    type: String,
    enum: ['subscription', 'installment_plan', 'fixed_income', 'variable_income',
           'fixed_expense', 'variable_expense', 'one_time'],
    default: 'one_time',
  },
  kind: {
    type: String,
    enum: ['income', 'expense'],
    required: true,
  },
  frequency: {
    type: String,
    enum: ['weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly',
           'semiannual', 'annual', 'unknown'],
    default: 'unknown',
  },

  anchor: {
    kind: { type: String, enum: ['dayOfMonth', 'dayOfWeek', 'businessDay'], default: 'dayOfMonth' },
    value: { type: Number, default: 1 },
    stddevDays: { type: Number, default: 0 },
  },

  amount: {
    mean: { type: Number, default: 0 },
    median: { type: Number, default: 0 },
    stddev: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
    currency: { type: String, default: 'ILS' },
    isFx: { type: Boolean, default: false },
  },

  installmentPlan: {
    type: {
      paymentsRemaining: Number,
      totalPayments: Number,
      monthlyAmount: Number,
      expectedLastPaymentDate: String,
    },
    default: null,
  },

  observed: {
    firstSeen: { type: String, default: '' },
    lastSeen: { type: String, default: '' },
    occurrences: { type: Number, default: 0 },
    missedInLast6Cycles: { type: Number, default: 0 },
    occurrenceTxIds: { type: [String], default: [] },
  },

  confidence: { type: Number, default: 0, min: 0, max: 1 },
  stability: { type: Number, default: 0, min: 0, max: 1 },

  signals: {
    companyIds: { type: [String], default: [] },
    categoryIds: { type: [String], default: [] },
    channels: { type: [String], default: [] },
    descriptionVariants: { type: [String], default: [] },
    memoVariants: { type: [String], default: [] },
  },

  userOverride: {
    type: {
      confirmed: Boolean,
      disabled: Boolean,
      customAmount: Number,
      customFrequency: String,
      customClassification: String,
    },
    default: null,
  },
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true,
  collection: 'recurringPatterns',
});

// Unique compound: one pattern per merchantKey per user.
RecurringPatternsSchema.index({ user_id: 1, merchantKey: 1 }, { unique: true });
// Sorted fetch by confidence.
RecurringPatternsSchema.index({ user_id: 1, confidence: -1 });
// Partial: installment plan queries.
RecurringPatternsSchema.index(
  { user_id: 1, 'installmentPlan.paymentsRemaining': 1 },
  { partialFilterExpression: { installmentPlan: { $ne: null } } }
);

export const RecurringPatterns = model<IRecurringPatternModel>(
  'RecurringPatterns',
  RecurringPatternsSchema,
  'recurringPatterns'
);
