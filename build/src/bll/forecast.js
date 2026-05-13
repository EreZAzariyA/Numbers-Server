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
exports.calculateForecast = void 0;
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const collections_1 = require("../collections");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
const ai_prompts_1 = require("../utils/ai-prompts");
const ai_provider_1 = require("../utils/ai-provider");
const settlement_detection_1 = require("../utils/settlement-detection");
const transaction_semantics_1 = require("../utils/transaction-semantics");
const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const calculateForecast = (user_id_1, ...args_1) => __awaiter(void 0, [user_id_1, ...args_1], void 0, function* (user_id, language = 'en') {
    var _a, _b;
    const cacheKey = `forecast:${user_id}:${language}`;
    const cached = yield cache_service_1.default.get(cacheKey);
    if (cached)
        return cached;
    const now = new Date();
    // Build since string — 7 months back (6 historical + current in-progress)
    // Critical: date field is stored as string "YYYY-MM-DD", use string comparison
    const since = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const sinceStr = since.toISOString().slice(0, 10);
    // Fetch from both collections (same pattern as detectRecurringTransactions)
    const [regularTxns, cardTxns] = yield Promise.all([
        collections_1.Transactions.find({
            user_id,
            status: transactions_1.TransactionStatuses.Completed,
            eventDate: { $gte: sinceStr },
        }).lean().exec(),
        collections_1.CardTransactions.find({
            user_id,
            status: transactions_1.TransactionStatuses.Completed,
            eventDate: { $gte: sinceStr },
        }).lean().exec(),
    ]);
    // Detect whether the user has granular card data — if so, bank-side
    // settlement rows (the monthly CC bill lump sum) are double-counting.
    const hasCardData = cardTxns.length > 0;
    const settlementTreatments = (0, settlement_detection_1.buildSettlementTreatmentMap)(regularTxns, cardTxns);
    const dataQuality = {
        lowConfidenceSettlementCount: 0,
        lowConfidenceSettlementSpend: 0,
        hasGranularCardData: hasCardData,
    };
    // Normalize — keep only expenses (amount < 0), take absolute value.
    // Exclude credit-card settlement rows when granular card data exists.
    const all = [...regularTxns, ...cardTxns]
        .map((t) => {
        var _a, _b, _c;
        return ({
            id: (_c = (_b = (_a = t._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : '',
            month: (0, transaction_semantics_1.getEventDate)(t).slice(0, 7),
            rawAmount: (0, transaction_semantics_1.getTransactionAmount)(t),
            description: (0, transaction_semantics_1.getTransactionTextSource)(t),
        });
    })
        .filter((t) => {
        var _a;
        if (t.rawAmount >= 0)
            return false; // keep only expenses
        const settlementTreatment = (_a = settlementTreatments.get(t.id)) !== null && _a !== void 0 ? _a : (0, settlement_detection_1.classifySettlement)(t.description, hasCardData);
        if (settlementTreatment === 'exclude')
            return false;
        if (settlementTreatment === 'low-confidence') {
            dataQuality.lowConfidenceSettlementCount += 1;
            dataQuality.lowConfidenceSettlementSpend += Math.abs(t.rawAmount);
        }
        return true;
    })
        .map((t) => ({ month: t.month, amount: Math.abs(t.rawAmount) }));
    // Group by month
    const byMonth = new Map();
    for (const t of all) {
        byMonth.set(t.month, ((_a = byMonth.get(t.month)) !== null && _a !== void 0 ? _a : 0) + t.amount);
    }
    // Separate current month from historical
    const currentMonthStr = now.toISOString().slice(0, 7); // "YYYY-MM"
    const currentMonthSpend = (_b = byMonth.get(currentMonthStr)) !== null && _b !== void 0 ? _b : 0;
    byMonth.delete(currentMonthStr);
    // Build sorted historical array (up to 6 most recent complete months)
    const historicalMonths = Array.from(byMonth.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-6)
        .map(([month, amount]) => ({ month, amount: Math.round(amount * 100) / 100 }));
    // Average from historical
    const averageMonthlySpend = historicalMonths.length > 0
        ? historicalMonths.reduce((s, m) => s + m.amount, 0) / historicalMonths.length
        : 0;
    // Pro-rate forecast
    const year = now.getFullYear();
    const month = now.getMonth();
    const totalDays = getDaysInMonth(year, month);
    const daysElapsed = now.getDate();
    const daysRemaining = totalDays - daysElapsed;
    const forecastAmount = daysElapsed > 0
        ? Math.round((currentMonthSpend / daysElapsed) * totalDays * 100) / 100
        : 0;
    // Trend
    let trend = 'flat';
    if (averageMonthlySpend > 0) {
        if (forecastAmount > averageMonthlySpend * 1.05)
            trend = 'up';
        else if (forecastAmount < averageMonthlySpend * 0.95)
            trend = 'down';
    }
    // Gemini AI insight — graceful degradation if key missing or call fails
    let aiInsight = '';
    const { systemInstruction, prompt } = (0, ai_prompts_1.buildForecastPrompt)({
        historicalMonths,
        currentMonthSpend,
        forecastAmount,
        averageMonthlySpend,
        trend,
        daysElapsed,
        totalDays,
        daysRemaining,
    }, language);
    aiInsight = yield (0, ai_provider_1.generateUserInsight)({
        user_id,
        context: 'forecast',
        prompt,
        systemInstruction,
        maxOutputTokens: 200,
    });
    const response = {
        historicalMonths,
        currentMonthSpend: Math.round(currentMonthSpend * 100) / 100,
        forecastAmount,
        averageMonthlySpend: Math.round(averageMonthlySpend * 100) / 100,
        daysRemaining,
        aiInsight,
        trend,
        dataQuality: Object.assign(Object.assign({}, dataQuality), { lowConfidenceSettlementSpend: Math.round(dataQuality.lowConfidenceSettlementSpend * 100) / 100 }),
    };
    yield cache_service_1.default.set(cacheKey, response, 300);
    return response;
});
exports.calculateForecast = calculateForecast;
