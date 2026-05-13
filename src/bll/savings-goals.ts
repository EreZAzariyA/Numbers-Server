import { TransactionStatuses } from 'israeli-bank-scrapers-for-e.a-servers/lib/transactions';
import { SavingsGoals } from '../collections/SavingsGoals';
import { Transactions, CardTransactions } from '../collections';
import { ClientError, UserModel } from '../models';
import { ISavingsGoalModel } from '../models/savings-goal-model';
import { ErrorMessages } from '../utils/helpers';
import cacheService from '../utils/cache-service';
import { buildSavingsGoalPrompt } from '../utils/ai-prompts';
import { generateUserInsight } from '../utils/ai-provider';
import { buildSettlementTreatmentMap, classifySettlement } from '../utils/settlement-detection';
import { getEventDate, getTransactionAmount, getTransactionTextSource } from '../utils/transaction-semantics';

const getCacheKey = (user_id: string, language: string) => `savingsGoals:${user_id}:${language}`;
const SAVINGS_INSIGHT_CONCURRENCY = 2;

export type SavingsGoalInput = Pick<ISavingsGoalModel, 'name' | 'targetAmount' | 'currentAmount' | 'targetDate'>;
export type SavingsGoalUpdateInput = SavingsGoalInput & Pick<ISavingsGoalModel, '_id'>;

const getAvgMonthlySavings = async (user_id: string): Promise<number> => {
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  since.setDate(1);
  const sinceStr = since.toISOString().slice(0, 10);

  const [regularTxns, cardTxns] = await Promise.all([
    Transactions.find({ user_id, status: TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
    CardTransactions.find({ user_id, status: TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
  ]);

  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const byMonth = new Map<string, number>();
  const hasCardData = cardTxns.length > 0;
  const settlementTreatments = buildSettlementTreatmentMap(regularTxns, cardTxns);

  for (const t of [...regularTxns, ...cardTxns] as any[]) {
    const month: string = getEventDate(t).slice(0, 7);
    if (month === currentMonthStr) continue;
    const settlementTreatment = settlementTreatments.get(t._id?.toString?.() ?? '')
      ?? classifySettlement(getTransactionTextSource(t), hasCardData);
    if (settlementTreatment === 'exclude') continue;
    const amount: number = getTransactionAmount(t);
    byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
  }

  const months = Array.from(byMonth.values());
  if (months.length === 0) return 0;
  const total = months.reduce((s, v) => s + v, 0);
  // Net savings per month (positive = saving, negative = spending more than income)
  return Math.round((total / months.length) * 100) / 100;
};

const generateInsight = async (
  user_id: string,
  goal: ISavingsGoalModel,
  avgMonthlySavings: number,
  language: string,
): Promise<string> => {
  const now = new Date();
  const target = new Date(goal.targetDate);
  const monthsRemaining = Math.max(
    0,
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth()),
  );
  const remaining = goal.targetAmount - goal.currentAmount;
  const requiredMonthly = monthsRemaining > 0 ? Math.round(remaining / monthsRemaining) : remaining;
  const progressPct = Math.round((goal.currentAmount / goal.targetAmount) * 100);
  const { systemInstruction, prompt } = buildSavingsGoalPrompt({
    name: goal.name,
    targetAmount: goal.targetAmount,
    currentAmount: goal.currentAmount,
    targetDate: goal.targetDate,
    monthsRemaining,
    remainingAmount: remaining,
    requiredMonthly,
    avgMonthlySavings,
    progressPct,
  }, language);

  return generateUserInsight({
    user_id,
    context: 'savings-goals',
    prompt,
    systemInstruction,
    maxOutputTokens: 150,
  });
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  };

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
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

    const enriched = await mapWithConcurrency(
      doc.goals,
      SAVINGS_INSIGHT_CONCURRENCY,
      async (goal) => {
        const goalData = goal.toObject() as ISavingsGoalModel;
        const insight = await generateInsight(user_id, goalData, avgMonthlySavings, language);
        return { ...goalData, aiInsight: insight } as ISavingsGoalModel;
      },
    );

    await cacheService.set(cacheKey, enriched, 300);
    return enriched;
  }

  async addGoal(user_id: string, goal: SavingsGoalInput): Promise<ISavingsGoalModel> {
    await UserModel.findById(user_id).catch(() => {
      throw new ClientError(400, ErrorMessages.USER_NOT_FOUND);
    });

    const newGoal = {
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount ?? 0,
      targetDate: goal.targetDate,
      aiInsight: '',
    };

    const updatedDoc = await SavingsGoals.findOneAndUpdate(
      { user_id },
      { $push: { goals: newGoal } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).select('goals').exec();

    const addedGoal = updatedDoc?.goals?.[updatedDoc.goals.length - 1];
    if (!addedGoal) throw new ClientError(500, 'Failed to create savings goal');

    await this.invalidateCache(user_id);
    return addedGoal.toObject() as ISavingsGoalModel;
  }

  async updateGoal(user_id: string, goal: SavingsGoalUpdateInput): Promise<ISavingsGoalModel> {
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
