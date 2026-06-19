import { TransactionStatuses, TransactionTypes } from "israeli-bank-scrapers-for-e.a-servers/lib/transactions";
import { Document, model, Schema } from "mongoose";

export interface ICardTransactionModel extends Document {
  user_id: Schema.Types.ObjectId;
  cardNumber?: string | number;
  cardLast4?: string | number;
  cardUniqueId?: string;
  type: TransactionTypes;
  eventDate: string;
  postingDate: string;
  billingDate?: string;
  date?: string;
  processedDate?: string;
  identifier: number | string;
  category_id: Schema.Types.ObjectId;
  description: string;
  amount: number;
  status: TransactionStatuses;
  companyId?: string;
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
  category?: string;
  categoryDescription?: string;
  channel?: string;
  channelName?: string;
  rawTransaction?: any;
};

const CardTransactionsSchema = new Schema<ICardTransactionModel>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: [true, 'User id is missing'],
  },
  cardNumber: {
    type: Schema.Types.Mixed,
  },
  cardLast4: {
    type: Schema.Types.Mixed,
  },
  cardUniqueId: {
    type: String,
    trim: true,
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

export const CardTransactions = model<ICardTransactionModel>('CardTransactions', CardTransactionsSchema, 'cardTransactions');
