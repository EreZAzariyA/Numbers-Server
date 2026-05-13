"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classify = void 0;
const SALARY_KEYWORDS = ['salary', 'wage', 'payroll', 'משכורת', 'שכר'];
const isOnlineChannel = (ch) => {
    if (!ch)
        return false;
    const lower = ch.toLowerCase();
    return lower.includes('online') || lower.includes('digital') || lower.includes('internet');
};
const classify = (input) => {
    // 1. Installment plan
    if (input.installmentTotal && input.installmentTotal > 1) {
        return 'installment_plan';
    }
    // 2. Fixed income (salary-like)
    if (input.kind === 'income' &&
        input.stability >= 0.85 &&
        input.frequency === 'monthly' &&
        (SALARY_KEYWORDS.some((kw) => { var _a; return ((_a = input.providerCategoryName) !== null && _a !== void 0 ? _a : '').toLowerCase().includes(kw); }) ||
            input.occurrences >= 3)) {
        return 'fixed_income';
    }
    // 3. Variable income
    if (input.kind === 'income' && input.stability > 0) {
        return 'variable_income';
    }
    // 4. Subscription (digital, consistent amount, recurring)
    if (input.kind === 'expense' &&
        isOnlineChannel(input.counterparty) &&
        input.amountStability >= 0.9 &&
        (input.frequency === 'monthly' || input.frequency === 'annual') &&
        input.occurrences >= 3) {
        return 'subscription';
    }
    // 5. Fixed expense
    if (input.kind === 'expense' &&
        input.amountStability >= 0.85 &&
        input.frequency !== 'unknown') {
        return 'fixed_expense';
    }
    // 6. Variable expense (recurring but amount varies)
    if (input.kind === 'expense' &&
        input.frequency !== 'unknown' &&
        input.amountStability < 0.85) {
        return 'variable_expense';
    }
    // 7. Default
    return 'one_time';
};
exports.classify = classify;
