import { Document, model, Schema, Types } from "mongoose";
import { Transaction, TransactionStatuses, TransactionTypes } from "israeli-bank-scrapers-for-e.a-servers/lib/transactions";

export interface ITransactionModel extends Transaction, Document {
  user_id: Types.ObjectId;
  type: TransactionTypes;
  date: string;
  processedDate: string;
  identifier: number | string;
  category_id: Types.ObjectId;
  description: string;
  amount: number;
  status: TransactionStatuses;
  companyId: string;
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
  date: {
    type: String,
    trim: true,
    required: [true, "Date is missing"],
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
