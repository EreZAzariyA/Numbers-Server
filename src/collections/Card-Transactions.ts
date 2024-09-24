import { TransactionStatuses } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import { Document, model, Schema } from "mongoose";

export interface ICardTransactionModel extends Document {
  user_id: Schema.Types.ObjectId;
  cardNumber: string | number;
  date: string;
  identifier: number | string;
  category_id: Schema.Types.ObjectId;
  description: string;
  amount: number;
  status?: TransactionStatuses;
  companyId?: string;
};

const CardTransactionsSchema = new Schema<ICardTransactionModel>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: [true, 'User id is missing'],
  },
  cardNumber: {
    type: Schema.Types.Mixed,
    required: [true, 'Card number is missing'],
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
  status: String,
  companyId: String
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true
});

export const CardTransactions = model<ICardTransactionModel>('CardTransactions', CardTransactionsSchema, 'cardTransactions');