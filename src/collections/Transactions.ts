import { Document, model, Schema, Types } from "mongoose";
import { Transaction, TransactionStatuses } from "israeli-bank-scrapers-for-e.a-servers/lib/transactions";

export interface ITransactionModel extends Transaction, Document {
  user_id: Types.ObjectId;
  date: string;
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
  date: {
    type: String,
    trim: true,
    required: [true, "Date is missing"],
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
  companyId: String
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true
});

export const Transactions = model<ITransactionModel>('Transactions', TransactionsSchema, 'transactions');