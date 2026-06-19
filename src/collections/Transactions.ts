import { Document, model, Schema, Types } from "mongoose";
import { TransactionStatuses, TransactionTypes } from "israeli-bank-scrapers-for-e.a-servers/lib/transactions";

export interface ITransactionModel extends Document {
  user_id: Types.ObjectId;
  type: TransactionTypes;
  eventDate: string;
  postingDate: string;
  billingDate?: string;
  date?: string;
  processedDate?: string;
  identifier: number | string;
  category_id: Types.ObjectId;
  description: string;
  amount: number;
  status: TransactionStatuses;
  companyId: string;
  originalAmount?: number;
  originalCurrency?: string;
  chargedAmount?: number;
  chargedCurrency?: string;
  memo?: string;
  installments?: { number?: number; total?: number };
  semanticType?: string;
  providerCategoryId?: string | number;
  providerCategoryName?: string;
  merchantId?: string;
  mcc?: string | number;
  counterparty?: string;
  cardUniqueId?: string;
  cardLast4?: string | number;
  category?: string;
  categoryDescription?: string;
  channel?: string;
  channelName?: string;
  rawTransaction?: any;
};

const TransactionsSchema = new Schema<ITransactionModel>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: [true, 'User id is missing'],
  },
  type: {
    type: String,
    trim: true,
  },
  eventDate: {
    type: String,
    trim: true,
    required: [true, "Date is missing"],
  },
  postingDate: {
    type: String,
    trim: true,
  },
  billingDate: {
    type: String,
    trim: true,
  },
  date: {
    type: String,
    trim: true,
  },
  processedDate: {
    type: String,
    trim: true,
  },
  identifier: {
    type: Schema.Types.Mixed,
    unique: true,
    sparse: true,
    default: undefined,
  },
  category_id: {
    type: Schema.Types.ObjectId,
    required: [true, "Category id is missing"],
  },
  description: {
    type: String,
    trim: true,
    required: [true, "Description is missing"],
  },
  amount: {
    type: Number,
    required: [true, "Amount is missing"],
  },
  status: {
    type: String,
    default: TransactionStatuses.Completed
  },
  companyId: String,
  originalAmount: { type: Number },
  originalCurrency: {
    type: String,
    trim: true,
  },
  chargedAmount: { type: Number },
  chargedCurrency: {
    type: String,
    trim: true,
  },
  memo: {
    type: String,
    trim: true,
  },
  installments: {
    number: { type: Number },
    total: { type: Number },
  },
  semanticType: {
    type: String,
    trim: true,
  },
  providerCategoryId: {
    type: Schema.Types.Mixed,
  },
  providerCategoryName: {
    type: String,
    trim: true,
  },
  merchantId: {
    type: String,
    trim: true,
  },
  mcc: {
    type: Schema.Types.Mixed,
  },
  counterparty: {
    type: String,
    trim: true,
  },
  cardUniqueId: {
    type: String,
    trim: true,
  },
  cardLast4: {
    type: Schema.Types.Mixed,
  },
  category: {
    type: String,
    trim: true,
  },
  categoryDescription: {
    type: String,
    trim: true,
  },
  channel: {
    type: String,
    trim: true,
  },
  channelName: {
    type: String,
    trim: true,
  },
  rawTransaction: { type: Schema.Types.Mixed },
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true
});

export const Transactions = model<ITransactionModel>('Transactions', TransactionsSchema, 'transactions');
