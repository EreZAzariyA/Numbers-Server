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
exports.calculateFinancialHealth = void 0;
const transactions_1 = require("israeli-bank-scrapers-for-e.a-servers/lib/transactions");
const collections_1 = require("../collections");
const cache_service_1 = __importDefault(require("../utils/cache-service"));
const ai_prompts_1 = require("../utils/ai-prompts");
const ai_provider_1 = require("../utils/ai-provider");
const settlement_detection_1 = require("../utils/settlement-detection");
const transaction_semantics_1 = require("../utils/transaction-semantics");
const toStatus = (score) => score >= 70 ? 'good' : score >= 40 ? 'warning' : 'bad';
const calculateFinancialHealth = (user_id_1, ...args_1) => __awaiter(void 0, [user_id_1, ...args_1], void 0, function* (user_id, language = 'en') {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const cacheKey = `financialHealth:${user_id}:${language}`;
    const cached = yield cache_service_1.default.get(cacheKey);
    if (cached)
        return cached;
    const now = new Date();
    const currentMonthStr = now.toISOString().slice(0, 7); // "YYYY-MM"
    const currentMonthStart = `${currentMonthStr}-01`;
    // --- Fetch current-month transactions (both collections) ---
    const [regularTxns, cardTxns] = yield Promise.all([
        collections_1.Transactions.find({
            user_id,
            status: transactions_1.TransactionStatuses.Completed,
            eventDate: { $gte: currentMonthStart },
        }).lean().exec(),
        collections_1.CardTransactions.find({
            user_id,
            status: transactions_1.TransactionStatuses.Completed,
            eventDate: { $gte: currentMonthStart },
        }).lean().exec(),
    ]);
    const hasCardData = cardTxns.length > 0;
    const settlementTreatments = (0, settlement_detection_1.buildSettlementTreatmentMap)(regularTxns, cardTxns);
    const dataQuality = {
        lowConfidenceSettlementCount: 0,
        lowConfidenceSettlementSpend: 0,
        hasGranularCardData: hasCardData,
    };
    const allCurrent = [...regularTxns, ...cardTxns]
        .filter((t) => {
        var _a, _b, _c, _d;
        const amount = (0, transaction_semantics_1.getTransactionAmount)(t);
        const settlementTreatment = (_d = settlementTreatments.get((_c = (_b = (_a = t._id) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : '')) !== null && _d !== void 0 ? _d : (0, settlement_detection_1.classifySettlement)((0, transaction_semantics_1.getTransactionTextSource)(t), hasCardData);
        if (settlementTreatment === 'exclude')
            return false;
        if (settlementTreatment === 'low-confidence' && amount < 0) {
            dataQuality.lowConfidenceSettlementCount += 1;
            dataQuality.lowConfidenceSettlementSpend += Math.abs(amount);
        }
        return true;
    })
        .map((t) => {
        var _a, _b;
        return ({
            amount: (0, transaction_semantics_1.getTransactionAmount)(t),
            category_id: (_b = (_a = t.category_id) === null || _a === void 0 ? void 0 : _a.toString()) !== null && _b !== void 0 ? _b : '',
        });
    });
    const incomeToDate = allCurrent.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expensesToDate = Math.abs(allCurrent.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
    const net = incomeToDate - expensesToDate;
    // --- Component 1: Cash Flow ---
    let cashFlowScore = 50;
    let cashFlowDetail = 'No income detected this month';
    if (incomeToDate > 0) {
        const ratio = net / incomeToDate;
        if (ratio > 0.1) {
            cashFlowScore = 100;
            cashFlowDetail = `Net +${Math.round(net).toLocaleString()} this month`;
        }
        else if (ratio >= -0.1) {
            cashFlowScore = 60;
            cashFlowDetail = `Near break-even (${Math.round(net).toLocaleString()})`;
        }
        else {
            cashFlowScore = 20;
            cashFlowDetail = `Deficit of ${Math.round(Math.abs(net)).toLocaleString()} this month`;
        }
    }
    const cashFlow = {
        score: cashFlowScore,
        status: cashFlowScore === 50 ? 'neutral' : toStatus(cashFlowScore),
        detail: cashFlowDetail,
    };
    // --- Component 2: Category Budgets ---
    const categoriesDoc = yield collections_1.Categories.findOne({ user_id }).lean().exec();
    const cats = (_a = categoriesDoc === null || categoriesDoc === void 0 ? void 0 : categoriesDoc.categories) !== null && _a !== void 0 ? _a : [];
    const activeLimits = cats.filter((c) => { var _a, _b, _c; return ((_a = c.maximumSpentAllowed) === null || _a === void 0 ? void 0 : _a.active) && ((_c = (_b = c.maximumSpentAllowed) === null || _b === void 0 ? void 0 : _b.maximumAmount) !== null && _c !== void 0 ? _c : 0) > 0; });
    let budgetsScore = 50;
    let budgetsDetail = 'No budget limits set';
    if (activeLimits.length > 0) {
        const spendByCategory = new Map();
        for (const t of allCurrent) {
            if (t.amount >= 0)
                continue; // skip income
            const spent = (_b = spendByCategory.get(t.category_id)) !== null && _b !== void 0 ? _b : 0;
            spendByCategory.set(t.category_id, spent + Math.abs(t.amount));
        }
        const exceededCount = activeLimits.filter((c) => {
            var _a, _b;
            const spent = (_b = spendByCategory.get((_a = c._id) === null || _a === void 0 ? void 0 : _a.toString())) !== null && _b !== void 0 ? _b : 0;
            return spent > c.maximumSpentAllowed.maximumAmount;
        }).length;
        if (exceededCount === 0) {
            budgetsScore = 100;
            budgetsDetail = `All ${activeLimits.length} budget limits within range`;
        }
        else if (exceededCount === 1) {
            budgetsScore = 65;
            budgetsDetail = `${exceededCount} budget limit exceeded this month`;
        }
        else if (exceededCount === 2) {
            budgetsScore = 35;
            budgetsDetail = `${exceededCount} budget limits exceeded this month`;
        }
        else {
            budgetsScore = 10;
            budgetsDetail = `${exceededCount} budget limits exceeded this month`;
        }
    }
    const categoryBudgets = {
        score: budgetsScore,
        status: budgetsScore === 50 ? 'neutral' : toStatus(budgetsScore),
        detail: budgetsDetail,
    };
    // --- Component 3: Savings Trend (last 3 complete months net) ---
    const threeMonthsAgoStr = new Date(now.getFullYear(), now.getMonth() - 3, 1)
        .toISOString().slice(0, 10);
    const [histRegular, histCard] = yield Promise.all([
        collections_1.Transactions.find({
            user_id,
            status: transactions_1.TransactionStatuses.Completed,
            eventDate: { $gte: threeMonthsAgoStr, $lt: currentMonthStart },
        }).lean().exec(),
        collections_1.CardTransactions.find({
            user_id,
            status: transactions_1.TransactionStatuses.Completed,
            eventDate: { $gte: threeMonthsAgoStr, $lt: currentMonthStart },
        }).lean().exec(),
    ]);
    const hasHistCardData = histCard.length > 0;
    const historicalSettlementTreatments = (0, settlement_detection_1.buildSettlementTreatmentMap)(histRegular, histCard);
    dataQuality.hasGranularCardData = hasCardData || hasHistCardData;
    const netByMonth = new Map();
    for (const t of [...histRegular, ...histCard]) {
        const desc = (0, transaction_semantics_1.getTransactionTextSource)(t);
        const amount = (0, transaction_semantics_1.getTransactionAmount)(t);
        const settlementTreatment = (_f = historicalSettlementTreatments.get((_e = (_d = (_c = t._id) === null || _c === void 0 ? void 0 : _c.toString) === null || _d === void 0 ? void 0 : _d.call(_c)) !== null && _e !== void 0 ? _e : '')) !== null && _f !== void 0 ? _f : (0, settlement_detection_1.classifySettlement)(desc, hasHistCardData);
        if (settlementTreatment === 'exclude')
            continue;
        if (settlementTreatment === 'low-confidence' && amount < 0) {
            dataQuality.lowConfidenceSettlementCount += 1;
            dataQuality.lowConfidenceSettlementSpend += Math.abs(amount);
        }
        const month = (0, transaction_semantics_1.getEventDate)(t).slice(0, 7);
        netByMonth.set(month, ((_g = netByMonth.get(month)) !== null && _g !== void 0 ? _g : 0) + amount);
    }
    const monthNets = Array.from(netByMonth.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, v]) => v);
    let savingsScore = 50;
    let savingsDetail = 'Not enough historical data';
    if (monthNets.length >= 2) {
        const allPositive = monthNets.every(n => n > 0);
        const improving = monthNets[monthNets.length - 1] > monthNets[monthNets.length - 2];
        if (allPositive && improving) {
            savingsScore = 100;
            savingsDetail = 'Savings growing month over month';
        }
        else if (allPositive) {
            savingsScore = 70;
            savingsDetail = 'Net positive savings (flat trend)';
        }
        else if (monthNets[monthNets.length - 1] > 0) {
            savingsScore = 55;
            savingsDetail = 'Mixed trend — last month was positive';
        }
        else {
            savingsScore = 15;
            savingsDetail = 'Spending exceeded income in recent months';
        }
    }
    const savingsTrend = {
        score: savingsScore,
        status: savingsScore === 50 ? 'neutral' : toStatus(savingsScore),
        detail: savingsDetail,
    };
    // --- Component 4: Debt Pressure ---
    const accountDoc = yield collections_1.Accounts.findOne({ user_id }).lean().exec();
    const banks = (_h = accountDoc === null || accountDoc === void 0 ? void 0 : accountDoc.banks) !== null && _h !== void 0 ? _h : [];
    const totalMonthlyLoanPayment = banks.reduce((sum, bank) => {
        var _a, _b, _c;
        return sum + ((_c = (_b = (_a = bank.loans) === null || _a === void 0 ? void 0 : _a.summary) === null || _b === void 0 ? void 0 : _b.currentMonthTotalPayment) !== null && _c !== void 0 ? _c : 0);
    }, 0);
    let debtScore = 100;
    let debtDetail = 'No loan payments detected';
    if (totalMonthlyLoanPayment > 0) {
        if (incomeToDate > 0) {
            const ratio = totalMonthlyLoanPayment / incomeToDate;
            if (ratio < 0.30) {
                debtScore = 100;
                debtDetail = `Loan payments are ${Math.round(ratio * 100)}% of income`;
            }
            else if (ratio < 0.50) {
                debtScore = 55;
                debtDetail = `Loan payments are ${Math.round(ratio * 100)}% of income`;
            }
            else {
                debtScore = 20;
                debtDetail = `High debt load: ${Math.round(ratio * 100)}% of income`;
            }
        }
        else {
            debtScore = 50;
            debtDetail = `Monthly loan payments: ${Math.round(totalMonthlyLoanPayment).toLocaleString()}`;
        }
    }
    const debtPressure = {
        score: debtScore,
        status: debtScore === 50 ? 'neutral' : toStatus(debtScore),
        detail: debtDetail,
    };
    // --- Overall score ---
    const score = Math.round(cashFlow.score * 0.30 +
        categoryBudgets.score * 0.25 +
        savingsTrend.score * 0.25 +
        debtPressure.score * 0.20);
    const status = score >= 70 ? 'good' : score >= 40 ? 'warning' : 'bad';
    // --- Gemini insight ---
    let aiInsight = '';
    const { systemInstruction, prompt } = (0, ai_prompts_1.buildFinancialHealthPrompt)({
        score,
        status,
        components: { cashFlow, categoryBudgets, savingsTrend, debtPressure },
    }, language);
    aiInsight = yield (0, ai_provider_1.generateUserInsight)({
        user_id,
        context: 'financial-health',
        prompt,
        systemInstruction,
        maxOutputTokens: 200,
    });
    const response = {
        score,
        status,
        components: { cashFlow, categoryBudgets, savingsTrend, debtPressure },
        aiInsight,
        dataQuality: Object.assign(Object.assign({}, dataQuality), { lowConfidenceSettlementSpend: Math.round(dataQuality.lowConfidenceSettlementSpend * 100) / 100 }),
    };
    yield cache_service_1.default.set(cacheKey, response, 300);
    return response;
});
exports.calculateFinancialHealth = calculateFinancialHealth;
