import { Document, Schema, model } from "mongoose";

export interface ISavingsGoalModel extends Document {
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;   // "YYYY-MM-DD"
  aiInsight: string;
}

export const SavingsGoalSchema = new Schema<ISavingsGoalModel>({
  name: { type: String, required: [true, 'Goal name is missing'], trim: true },
  targetAmount: { type: Number, required: [true, 'Target amount is missing'] },
  currentAmount: { type: Number, default: 0 },
  targetDate: { type: String, required: [true, 'Target date is missing'] },
  aiInsight: { type: String, default: '' },
}, { versionKey: false });

export const SavingsGoalModel = model<ISavingsGoalModel>('SavingsGoal', SavingsGoalSchema);
