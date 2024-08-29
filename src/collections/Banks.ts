import { model, Schema } from "mongoose";
import { BankScheme, IBankModal } from "../models/bank-model";

export interface IUserBanksModal extends Document {
  user_id: Schema.Types.ObjectId;
  banks: IBankModal[];
};

const BanksSchema = new Schema<IUserBanksModal>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: [true, "User id is missing"]
  },
  banks: [BankScheme]
}, {
  versionKey: false,
  autoIndex: true,
});

export const Banks = model('Banks', BanksSchema, 'banks');
