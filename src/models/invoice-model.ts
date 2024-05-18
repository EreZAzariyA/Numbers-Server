import { CompanyTypes } from "israeli-bank-scrapers";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions";
import { Document, Schema, model } from "mongoose";

export interface IInvoiceModel extends Document {
  user_id: Schema.Types.ObjectId;
  date: string;
  identifier?: number;
  category_id: Schema.Types.ObjectId | any;
  description: string;
  amount: number;
  status: string;
  companyId: CompanyTypes
};

const InvoiceSchema = new Schema<IInvoiceModel>({
  user_id: {
    type: Schema.Types.ObjectId,
    index: true
  },
  date: {
    type: String,
    trim: true,
    required: [true, "Date is missing"],
  },
  identifier: {
    type: Number
  },
  category_id: {
    type: Schema.Types.ObjectId,
    required: [true, "Category id is missing"],
  },
  description: {
    type: String,
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
  companyId: {
    type: String
  }
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true,
});

export const InvoiceModel = model<IInvoiceModel>('InvoiceModel', InvoiceSchema, 'invoices');