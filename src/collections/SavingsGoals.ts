import { Document, model, Schema } from "mongoose";
import { ISavingsGoalModel, SavingsGoalSchema } from "../models/savings-goal-model";

export interface ISavingsGoalsCollection extends Document {
  user_id: Schema.Types.ObjectId;
  goals: ISavingsGoalModel[];
}

const SavingsGoalsSchema = new Schema<ISavingsGoalsCollection>({
  user_id: {
    type: Schema.Types.ObjectId,
    required: [true, 'User id is missing'],
    unique: true,
  },
  goals: {
    type: [SavingsGoalSchema],
    default: [],
  },
}, {
  versionKey: false,
  autoIndex: true,
  timestamps: true,
});

export const SavingsGoals = model<ISavingsGoalsCollection>('SavingsGoals', SavingsGoalsSchema, 'savingsGoals');
