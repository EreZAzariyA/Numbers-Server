import { model, Schema } from "mongoose";
import { BankScheme, IAccountModal } from "../models/bank-model";

export interface IBanksModal extends Document {
  _id: Schema.Types.ObjectId;
  user_id: Schema.Types.ObjectId;
  banks: IAccountModal[];
};

const BanksSchema = new Schema<IBanksModal>({
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

export const Banks = model<IBanksModal>('Banks', BanksSchema, 'banks');
