import { model, Schema } from "mongoose";
import { BankScheme, IBankModal } from "../models/bank-model";

export interface IAccountModel extends Document {
  _id: Schema.Types.ObjectId;
  user_id: Schema.Types.ObjectId;
  banks: IBankModal[];
};

const BanksSchema = new Schema<IAccountModel>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: [true, "User id is missing"],
    unique: true,
  },
  banks: {
    type: [BankScheme],
    default: []
  }
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true
});

export const Accounts = model<IAccountModel>('Accounts', BanksSchema, 'banks');
