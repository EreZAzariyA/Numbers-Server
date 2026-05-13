"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const SavingsGoals_1 = require("../collections/SavingsGoals");
const collections_1 = require("../collections");
const models_1 = require("../models");
const helpers_1 = require("../utils/helpers");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
const ai_prompts_1 = require("../utils/ai-prompts");
const ai_provider_1 = require("../utils/ai-provider");
const settlement_detection_1 = require("../utils/settlement-detection");
const transaction_semantics_1 = require("../utils/transaction-semantics");
const getCacheKey = (user_id, language) => `savingsGoals:${user_id}:${language}`;
const SAVINGS_INSIGHT_CONCURRENCY = 2;
const getAvgMonthlySavings = (user_id) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const since = new Date();
    since.setMonth(since.getMonth() - 6);
    since.setDate(1);
    const sinceStr = since.toISOString().slice(0, 10);
    const [regularTxns, cardTxns] = yield Promise.all([
        collections_1.Transactions.find({ user_id, status: transactions_1.TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
        collections_1.CardTransactions.find({ user_id, status: transactions_1.TransactionStatuses.Completed, eventDate: { $gte: sinceStr } }).lean().exec(),
    ]);
    const currentMonthStr = new Date().toISOString().slice(0, 7);
    const byMonth = new Map();
    const hasCardData = cardTxns.length > 0;
    const settlementTreatments = (0, settlement_detection_1.buildSettlementTreatmentMap)(regularTxns, cardTxns);
    for (const t of [...regularTxns, ...cardTxns]) {
        const month = (0, transaction_semantics_1.getEventDate)(t).slice(0, 7);
        if (month === currentMonthStr)
            continue;
        const settlementTreatment = (_d = settlementTreatments.get((_c = (_b = (_a = t._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : '')) !== null && _d !== void 0 ? _d : (0, settlement_detection_1.classifySettlement)((0, transaction_semantics_1.getTransactionTextSource)(t), hasCardData);
        if (settlementTreatment === 'exclude')
            continue;
        const amount = (0, transaction_semantics_1.getTransactionAmount)(t);
        byMonth.set(month, ((_e = byMonth.get(month)) !== null && _e !== void 0 ? _e : 0) + amount);
    }
    const months = Array.from(byMonth.values());
    if (months.length === 0)
        return 0;
    const total = months.reduce((s, v) => s + v, 0);
    // Net savings per month (positive = saving, negative = spending more than income)
    return Math.round((total / months.length) * 100) / 100;
});
const generateInsight = (user_id, goal, avgMonthlySavings, language) => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date();
    const target = new Date(goal.targetDate);
    const monthsRemaining = Math.max(0, (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth()));
    const remaining = goal.targetAmount - goal.currentAmount;
    const requiredMonthly = monthsRemaining > 0 ? Math.round(remaining / monthsRemaining) : remaining;
    const progressPct = Math.round((goal.currentAmount / goal.targetAmount) * 100);
    const { systemInstruction, prompt } = (0, ai_prompts_1.buildSavingsGoalPrompt)({
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
    return (0, ai_provider_1.generateUserInsight)({
        user_id,
        context: 'savings-goals',
        prompt,
        systemInstruction,
        maxOutputTokens: 150,
    });
});
const mapWithConcurrency = (items, limit, mapper) => __awaiter(void 0, void 0, void 0, function* () {
    const results = new Array(items.length);
    let nextIndex = 0;
    const runWorker = () => __awaiter(void 0, void 0, void 0, function* () {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex++;
            results[currentIndex] = yield mapper(items[currentIndex]);
        }
    });
    const workerCount = Math.min(limit, items.length);
    yield Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
});
class SavingsGoalsLogic {
    createUserGoals(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            const doc = new SavingsGoals_1.SavingsGoals({ user_id, goals: [] });
            const errors = doc.validateSync();
            if (errors)
                throw new models_1.ClientError(500, errors.message);
            return doc.save();
        });
    }
    fetchGoals(user_id_1) {
        return __awaiter(this, arguments, void 0, function* (user_id, language = 'en') {
            const cacheKey = getCacheKey(user_id, language);
            const cached = yield cache_service_1.default.get(cacheKey);
            if (cached)
                return cached;
            let doc = yield SavingsGoals_1.SavingsGoals.findOne({ user_id }).exec();
            if (!doc)
                doc = yield this.createUserGoals(user_id);
            if (doc.goals.length === 0)
                return [];
            const avgMonthlySavings = yield getAvgMonthlySavings(user_id);
            const enriched = yield mapWithConcurrency(doc.goals, SAVINGS_INSIGHT_CONCURRENCY, (goal) => __awaiter(this, void 0, void 0, function* () {
                const goalData = goal.toObject();
                const insight = yield generateInsight(user_id, goalData, avgMonthlySavings, language);
                return Object.assign(Object.assign({}, goalData), { aiInsight: insight });
            }));
            yield cache_service_1.default.set(cacheKey, enriched, 300);
            return enriched;
        });
    }
    addGoal(user_id, goal) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            yield models_1.UserModel.findById(user_id).catch(() => {
                throw new models_1.ClientError(400, helpers_1.ErrorMessages.USER_NOT_FOUND);
            });
            const newGoal = {
                name: goal.name,
                targetAmount: goal.targetAmount,
                currentAmount: (_a = goal.currentAmount) !== null && _a !== void 0 ? _a : 0,
                targetDate: goal.targetDate,
                aiInsight: '',
            };
            const updatedDoc = yield SavingsGoals_1.SavingsGoals.findOneAndUpdate({ user_id }, { $push: { goals: newGoal } }, { new: true, upsert: true, setDefaultsOnInsert: true }).select('goals').exec();
            const addedGoal = (_b = updatedDoc === null || updatedDoc === void 0 ? void 0 : updatedDoc.goals) === null || _b === void 0 ? void 0 : _b[updatedDoc.goals.length - 1];
            if (!addedGoal)
                throw new models_1.ClientError(500, 'Failed to create savings goal');
            yield this.invalidateCache(user_id);
            return addedGoal.toObject();
        });
    }
    updateGoal(user_id, goal) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedDoc = yield SavingsGoals_1.SavingsGoals.findOneAndUpdate({ user_id, 'goals._id': goal._id }, { $set: { 'goals.$': Object.assign(Object.assign({}, goal), { aiInsight: '' }) } }, { new: true }).select('goals').exec();
            if (!updatedDoc)
                throw new models_1.ClientError(404, 'Goal not found');
            const updated = updatedDoc.goals.find((g) => g._id.toString() === goal._id.toString());
            if (!updated)
                throw new models_1.ClientError(404, 'Updated goal not found');
            yield this.invalidateCache(user_id);
            return updated;
        });
    }
    removeGoal(user_id, goal_id) {
        return __awaiter(this, void 0, void 0, function* () {
            yield SavingsGoals_1.SavingsGoals.findOneAndUpdate({ user_id }, { $pull: { goals: { _id: goal_id } } }, { new: true }).exec();
            yield this.invalidateCache(user_id);
        });
    }
    invalidateCache(user_id) {
        return __awaiter(this, void 0, void 0, function* () {
            yield Promise.all([
                cache_service_1.default.del(getCacheKey(user_id, 'en')),
                cache_service_1.default.del(getCacheKey(user_id, 'he')),
            ]);
        });
    }
}
const savingsGoalsLogic = new SavingsGoalsLogic();
exports.default = savingsGoalsLogic;
