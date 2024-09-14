import { Document, model, Schema } from "mongoose";
import { TransactionStatuses } from "israeli-bank-scrapers-by-e.a/lib/transactions";

export interface ITransactionModel extends Document {
  user_id: Schema.Types.ObjectId;
  date: string;
  identifier: number | string;
  category_id: Schema.Types.ObjectId;
  description: string;
  amount: number;
  status: string;
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