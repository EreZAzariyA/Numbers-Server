import { GoogleGenerativeAI } from '@google/generative-ai';
import { TransactionStatuses } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { SavingsGoals } from '../collections/SavingsGoals';
import { Transactions, CardTransactions } from '../collections';
import { ClientError, UserModel } from '../models';
import { ISavingsGoalModel, SavingsGoalModel } from '../models/savings-goal-model';
import { ErrorMessages } from '../utils/helpers';
import cacheService from '../utils/cache-service';

const getCacheKey = (user_id: string, language: string) => `savingsGoals:${user_id}:${language}`;

const getAvgMonthlySavings = async (user_id: string): Promise<number> => {
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  since.setDate(1);
  const sinceStr = since.toISOString().slice(0, 10);

  const [regularTxns, cardTxns] = await Promise.all([
    Transactions.find({ user_id, status: TransactionStatuses.Completed, date: { $gte: sinceStr } }).lean().exec(),
    CardTransactions.find({ user_id, status: TransactionStatuses.Completed, date: { $gte: sinceStr } }).lean().exec(),
  ]);

  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const byMonth = new Map<string, number>();

  for (const t of [...regularTxns, ...cardTxns] as any[]) {
    const month: string = (t.date as string).slice(0, 7);
    if (month === currentMonthStr) continue;
    const amount: number = t.amount ?? t.chargedAmount ?? 0;
    byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
  }

  const months = Array.from(byMonth.values());
  if (months.length === 0) return 0;
  const total = months.reduce((s, v) => s + v, 0);
  // Net savings per month (positive = saving, negative = spending more than income)
  return Math.round((total / months.length) * 100) / 100;
};

const generateInsight = async (
  goal: ISavingsGoalModel,
  avgMonthlySavings: number,
  language: string,
): Promise<string> => {
  try {
    if (!process.env.GEMINI_API_KEY) return '';

    const now = new Date();
    const target = new Date(goal.targetDate);
    const monthsRemaining = Math.max(
      0,
      (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth()),
    );
    const remaining = goal.targetAmount - goal.currentAmount;
    const requiredMonthly = monthsRemaining > 0 ? Math.round(remaining / monthsRemaining) : remaining;
    const progressPct = Math.round((goal.currentAmount / goal.targetAmount) * 100);

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { maxOutputTokens: 150 },
      systemInstruction: `You are a personal finance assistant. Respond in ${language === 'he' ? 'Hebrew' : 'English'}. Be concise, encouraging, and practical.`,
    });

    const prompt = `Savings goal: "${goal.name}"
- Target: ₪${goal.targetAmount}, Saved: ₪${goal.currentAmount} (${progressPct}%)
- Deadline: ${goal.targetDate} (${monthsRemaining} months away)
- Required monthly savings: ₪${requiredMonthly}
- User's avg monthly net savings: ₪${avgMonthlySavings}
Write exactly 2 sentences: (1) whether they are on track, (2) one specific actionable tip.`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err: any) {
    console.error('Gemini savings insight error:', err?.message ?? err);
    return '';
  }
};

class SavingsGoalsLogic {
  async createUserGoals(user_id: string) {
    const doc = new SavingsGoals({ user_id, goals: [] });
    const errors = doc.validateSync();
    if (errors) throw new ClientError(500, errors.message);
    return doc.save();
  }

  async fetchGoals(user_id: string, language: string = 'en'): Promise<ISavingsGoalModel[]> {
    const cacheKey = getCacheKey(user_id, language);
    const cached = await cacheService.get<ISavingsGoalModel[]>(cacheKey);
    if (cached) return cached;

    let doc = await SavingsGoals.findOne({ user_id }).exec();
    if (!doc) doc = await this.createUserGoals(user_id);
    if (doc.goals.length === 0) return [];

    const avgMonthlySavings = await getAvgMonthlySavings(user_id);

    const enriched = await Promise.all(
      doc.goals.map(async (goal) => {
        const insight = await generateInsight(goal.toObject() as ISavingsGoalModel, avgMonthlySavings, language);
        return { ...goal.toObject(), aiInsight: insight } as ISavingsGoalModel;
      }),
    );

    await cacheService.set(cacheKey, enriched, 300);
    return enriched;
  }

  async addGoal(user_id: string, goal: ISavingsGoalModel): Promise<ISavingsGoalModel> {
    await UserModel.findById(user_id).catch(() => {
      throw new ClientError(400, ErrorMessages.USER_NOT_FOUND);
    });

    const newGoal = new SavingsGoalModel({
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount ?? 0,
      targetDate: goal.targetDate,
      aiInsight: '',
    });

    await SavingsGoals.findOneAndUpdate(
      { user_id },
      { $push: { goals: newGoal } },
      { new: true, upsert: true },
    ).exec();

    await this.invalidateCache(user_id);
    return newGoal;
  }

  async updateGoal(user_id: string, goal: ISavingsGoalModel): Promise<ISavingsGoalModel> {
    const updatedDoc = await SavingsGoals.findOneAndUpdate(
      { user_id, 'goals._id': goal._id },
      { $set: { 'goals.$': { ...goal, aiInsight: '' } } },
      { new: true },
    ).select('goals').exec();

    if (!updatedDoc) throw new ClientError(404, 'Goal not found');

    const updated = updatedDoc.goals.find((g) => g._id.toString() === goal._id.toString());
    if (!updated) throw new ClientError(404, 'Updated goal not found');

    await this.invalidateCache(user_id);
    return updated;
  }

  async removeGoal(user_id: string, goal_id: string): Promise<void> {
    await SavingsGoals.findOneAndUpdate(
      { user_id },
      { $pull: { goals: { _id: goal_id } } },
      { new: true },
    ).exec();

    await this.invalidateCache(user_id);
  }

  private async invalidateCache(user_id: string) {
    await Promise.all([
      cacheService.del(getCacheKey(user_id, 'en')),
      cacheService.del(getCacheKey(user_id, 'he')),
    ]);
  }
}

const savingsGoalsLogic = new SavingsGoalsLogic();
export default savingsGoalsLogic;
