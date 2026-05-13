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
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const generative_ai_1 = require("@google/generative-ai");
const ai_prompts_1 = require("../src/utils/ai-prompts");
const forecastCases = [
    {
        name: 'Forecast Case 1: Mid-month overspending',
        input: {
            historicalMonths: [
                { month: '2025-10', amount: 6840.25 },
                { month: '2025-11', amount: 7015.40 },
                { month: '2025-12', amount: 7348.90 },
                { month: '2026-01', amount: 6922.15 },
                { month: '2026-02', amount: 7188.55 },
                { month: '2026-03', amount: 7029.80 },
            ],
            currentMonthSpend: 5120.65,
            forecastAmount: 9036.44,
            averageMonthlySpend: 7057.51,
            trend: 'up',
            daysElapsed: 17,
            totalDays: 30,
            daysRemaining: 13,
        },
        simulatedOutput: 'Projected spending is running well above your recent baseline, which puts this month at real risk of finishing over budget. Reduce discretionary spending for the remaining days and review any large planned purchases before they post.',
        review: {
            readability: 'Clear sections separate the baseline from the current month and make the main comparison easy to scan.',
            ambiguity: 'Trend labels are supported by an explicit delta and percentage, so "up" is no longer vague on its own.',
            formatGuidance: 'The prompt now requires exactly 2 sentences, plain text, one comparison sentence and one action sentence.',
            reasoningSupport: 'The baseline, projected total, and variance are all present, so the model has the minimum data needed to reason about budget pressure.',
            outputEvaluation: 'The simulated response follows the 2-sentence format, uses the overspending signal correctly, and gives a specific short-term action.',
        },
    },
    {
        name: 'Forecast Case 2: Spending comfortably below baseline',
        input: {
            historicalMonths: [
                { month: '2025-10', amount: 9422.70 },
                { month: '2025-11', amount: 9798.45 },
                { month: '2025-12', amount: 10122.80 },
                { month: '2026-01', amount: 9566.95 },
                { month: '2026-02', amount: 9311.30 },
                { month: '2026-03', amount: 9733.55 },
            ],
            currentMonthSpend: 3815.90,
            forecastAmount: 6733.94,
            averageMonthlySpend: 9659.29,
            trend: 'down',
            daysElapsed: 17,
            totalDays: 30,
            daysRemaining: 13,
        },
        simulatedOutput: 'Projected spending is materially below your recent baseline, which suggests this month is tracking with more budget headroom than usual. Lock in that advantage by keeping variable spending restrained and directing any leftover room toward savings or debt reduction.',
        review: {
            readability: 'The structure is still easy to read even when the signal is positive instead of negative.',
            ambiguity: 'The phrase "below baseline" is grounded by an explicit signed difference and percentage.',
            formatGuidance: 'The two-sentence rule remains strong and prevents the model from turning the answer into a mini-report.',
            reasoningSupport: 'The prompt gives enough context for the model to distinguish genuine underspending from incomplete month data.',
            outputEvaluation: 'The simulated response is grounded in the provided numbers and keeps the advice specific instead of generic praise.',
        },
    },
    {
        name: 'Forecast Case 3: Near baseline / flat trend',
        input: {
            historicalMonths: [
                { month: '2025-10', amount: 8120.40 },
                { month: '2025-11', amount: 8248.15 },
                { month: '2025-12', amount: 7988.95 },
                { month: '2026-01', amount: 8355.60 },
                { month: '2026-02', amount: 8064.75 },
                { month: '2026-03', amount: 8199.20 },
            ],
            currentMonthSpend: 4595.35,
            forecastAmount: 8109.44,
            averageMonthlySpend: 8162.84,
            trend: 'flat',
            daysElapsed: 17,
            totalDays: 30,
            daysRemaining: 13,
        },
        simulatedOutput: 'Projected spending is roughly in line with your normal monthly pattern, so the budget is stable for now rather than moving sharply in either direction. Keep watching discretionary purchases through month end so the month stays close to baseline instead of drifting upward.',
        review: {
            readability: 'The prompt remains readable when the answer should be neutral rather than strongly positive or negative.',
            ambiguity: 'The flat case is strengthened by a near-zero variance field rather than relying on the label alone.',
            formatGuidance: 'The output format is explicit enough to keep the model from overexplaining a neutral case.',
            reasoningSupport: 'The prompt includes the exact comparison needed to justify a stable assessment.',
            outputEvaluation: 'The simulated response stays grounded and does not invent urgency where the numbers do not support it.',
        },
    },
];
const financialHealthCases = [
    {
        name: 'Financial Health Case 1: Strong overall position',
        input: {
            score: 86,
            status: 'good',
            components: {
                cashFlow: { score: 100, status: 'good', detail: 'Net +4,200 this month' },
                categoryBudgets: { score: 100, status: 'good', detail: 'All 5 budget limits within range' },
                savingsTrend: { score: 70, status: 'good', detail: 'Net positive savings (flat trend)' },
                debtPressure: { score: 55, status: 'warning', detail: 'Loan payments are 34% of income' },
            },
        },
        simulatedOutput: 'Your score is strong because cash flow is healthy and budget controls are holding, which offsets the moderate debt burden. Keep the momentum by directing part of this month’s surplus to debt reduction so the balance sheet improves without straining cash flow.',
        review: {
            readability: 'The overall score, component details, and priority signals are separated cleanly, so the model can identify the driver quickly.',
            ambiguity: 'Weakest-component labeling removes guesswork about which signal should dominate the explanation.',
            formatGuidance: 'Exactly 2 sentences plus a “biggest risk first” rule makes the response style more predictable.',
            reasoningSupport: 'The score, status, and each component’s detail provide enough evidence to justify a balanced interpretation.',
            outputEvaluation: 'The simulated response correctly balances strong performance with one constrained action instead of reciting all four components.',
        },
    },
    {
        name: 'Financial Health Case 2: Warning due to deficit and debt load',
        input: {
            score: 43,
            status: 'warning',
            components: {
                cashFlow: { score: 20, status: 'bad', detail: 'Deficit of 3,150 this month' },
                categoryBudgets: { score: 65, status: 'warning', detail: '1 budget limit exceeded this month' },
                savingsTrend: { score: 55, status: 'warning', detail: 'Mixed trend — last month was positive' },
                debtPressure: { score: 20, status: 'bad', detail: 'High debt load: 52% of income' },
            },
        },
        simulatedOutput: 'The score is weak mainly because the month is running at a deficit while debt payments already consume a heavy share of income, leaving very little room for error. Prioritize cutting or delaying variable spending immediately so more income is available to cover fixed debt obligations.',
        review: {
            readability: 'The prompt makes the two main negative signals visible in both the component list and the priority section.',
            ambiguity: 'The “main risk signals” field reduces the chance that the model latches onto a less important warning.',
            formatGuidance: 'The answer constraints are strict enough to prevent a four-component recap.',
            reasoningSupport: 'The combination of deficit detail and debt ratio gives the model a concrete basis for identifying the dominant risk.',
            outputEvaluation: 'The simulated response is grounded in the worst signals and gives a direct action tied to the actual risk profile.',
        },
    },
    {
        name: 'Financial Health Case 3: Bad due to broad-based weakness',
        input: {
            score: 24,
            status: 'bad',
            components: {
                cashFlow: { score: 20, status: 'bad', detail: 'Deficit of 5,980 this month' },
                categoryBudgets: { score: 10, status: 'bad', detail: '3 budget limits exceeded this month' },
                savingsTrend: { score: 15, status: 'bad', detail: 'Spending exceeded income in recent months' },
                debtPressure: { score: 55, status: 'warning', detail: 'Loan payments are 41% of income' },
            },
        },
        simulatedOutput: 'The score is poor because overspending is happening on multiple fronts at once, with budget overruns and recent negative savings trends reinforcing a large monthly deficit. Freeze non-essential spending and rebuild control around the categories that are already over limit before taking on any new discretionary commitments.',
        review: {
            readability: 'The prompt gives a compact but sufficiently rich view of the weak signals without noise from unrelated metrics.',
            ambiguity: 'The explicit weakest-component line helps the model identify that category control is the sharpest failure point.',
            formatGuidance: 'The constraints continue to push a short explanation plus one action rather than a generic lecture.',
            reasoningSupport: 'The score and detailed component text support a grounded interpretation of broad-based weakness.',
            outputEvaluation: 'The simulated response does not hallucinate missing categories and keeps the action anchored to overspending control.',
        },
    },
];
const savingsGoalCases = [
    {
        name: 'Savings Goal Case 1: On track for home down payment',
        input: {
            name: 'Home down payment',
            targetAmount: 120000,
            currentAmount: 46000,
            targetDate: '2027-06-01',
            monthsRemaining: 14,
            remainingAmount: 74000,
            requiredMonthly: 5285.71,
            avgMonthlySavings: 6100.35,
            progressPct: 38,
        },
        simulatedOutput: 'You are on track because your recent monthly savings pace is already above what this goal requires by the deadline. Keep routing that surplus into the goal automatically each month so progress stays steady and you avoid slipping later.',
        review: {
            readability: 'The prompt lays out the target, current progress, deadline, and pace comparison in a clean sequence.',
            ambiguity: 'The explicit pace status and monthly gap remove ambiguity about whether the user is truly on track.',
            formatGuidance: 'Exactly 2 short sentences keeps the answer compact and consistent across goals.',
            reasoningSupport: 'The required pace and actual pace are the key signals for this reasoning task, and both are present.',
            outputEvaluation: 'The simulated response is grounded and specific without inventing extra financial context.',
        },
    },
    {
        name: 'Savings Goal Case 2: Emergency fund is falling behind',
        input: {
            name: 'Emergency fund',
            targetAmount: 18000,
            currentAmount: 7400,
            targetDate: '2026-11-01',
            monthsRemaining: 7,
            remainingAmount: 10600,
            requiredMonthly: 1514.29,
            avgMonthlySavings: 980.40,
            progressPct: 41,
        },
        simulatedOutput: 'You are far behind because your recent monthly savings pace is below what this goal needs to reach the target date. Increase the amount going into this fund each month or push the deadline back so the target matches your real saving capacity.',
        review: {
            readability: 'The pace gap and pace status fields surface the decision-critical signal immediately.',
            ambiguity: 'The model no longer has to infer “behind” from separate values because the pace comparison is explicit.',
            formatGuidance: 'The short-sentence requirement reduces the chance of generic motivational language.',
            reasoningSupport: 'Required pace, current pace, and deadline are enough to support a grounded on-track judgment.',
            outputEvaluation: 'The simulated response follows the required format and addresses the exact shortfall instead of offering vague savings advice.',
        },
    },
    {
        name: 'Savings Goal Case 3: Vacation fund slightly behind but recoverable',
        input: {
            name: 'Family vacation',
            targetAmount: 24000,
            currentAmount: 16800,
            targetDate: '2026-12-01',
            monthsRemaining: 8,
            remainingAmount: 7200,
            requiredMonthly: 900,
            avgMonthlySavings: 805.50,
            progressPct: 70,
        },
        simulatedOutput: 'You are slightly behind because your current savings pace is close to the target but still not enough to fully cover the remaining amount by the deadline. Add a modest monthly increase to this goal now so the shortfall does not compound over the final stretch.',
        review: {
            readability: 'The case remains readable even when the signal is borderline rather than clearly on track or clearly behind.',
            ambiguity: 'The distinction between “slightly behind” and “far behind” is supported by the explicit pace gap rule.',
            formatGuidance: 'The prompt strongly steers the model into one status sentence and one action sentence.',
            reasoningSupport: 'The answer can be grounded directly in the narrow gap between required and actual pace.',
            outputEvaluation: 'The simulated response is specific and avoids overstating the severity of the problem.',
        },
    },
];
const MAX_RETRIES = 4;
const INITIAL_RETRY_DELAY_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryableModelError = (err) => (err === null || err === void 0 ? void 0 : err.status) === 429 || (err === null || err === void 0 ? void 0 : err.status) === 500 || (err === null || err === void 0 ? void 0 : err.status) === 503;
const formatModelError = (err) => {
    var _a;
    const status = (err === null || err === void 0 ? void 0 : err.status) ? `status ${err.status}` : 'unknown status';
    const message = (_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : 'Unknown Gemini error';
    return `${status}: ${message}`;
};
const countSentences = (text) => {
    const matches = text.trim().match(/[^.!?]+[.!?]+/g);
    return matches ? matches.length : 0;
};
const validateLiveOutput = (text) => {
    const trimmed = text.trim();
    if (!trimmed)
        return 'Gemini returned an empty response.';
    if (trimmed.length < 60)
        return `Gemini returned an unexpectedly short response (${trimmed.length} chars).`;
    if (!/[.!?]$/.test(trimmed))
        return 'Gemini response did not end with sentence punctuation.';
    const sentenceCount = countSentences(trimmed);
    if (sentenceCount !== 2)
        return `Gemini response had ${sentenceCount} detected sentences instead of exactly 2.`;
    return null;
};
const runPrompt = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('replace-with-a-rotated')) {
        return {
            output: null,
            mode: 'simulated output',
            errorNote: 'No active Gemini key was available to the evaluator process.',
        };
    }
    const client = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = client.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 200 },
        systemInstruction: payload.systemInstruction,
    });
    let delayMs = INITIAL_RETRY_DELAY_MS;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = yield model.generateContent(payload.prompt);
            const text = result.response.text().trim();
            const validationError = validateLiveOutput(text);
            if (validationError) {
                return {
                    output: null,
                    mode: 'simulated output',
                    errorNote: `Gemini returned an invalid response: ${validationError}`,
                };
            }
            return {
                output: text,
                mode: 'live Gemini output',
            };
        }
        catch (err) {
            if (!isRetryableModelError(err) || attempt === MAX_RETRIES) {
                return {
                    output: null,
                    mode: 'simulated output',
                    errorNote: `Gemini request failed after ${attempt} attempt(s): ${formatModelError(err)}`,
                };
            }
            yield sleep(delayMs);
            delayMs *= 2;
        }
    }
    return {
        output: null,
        mode: 'simulated output',
        errorNote: 'Gemini request did not complete and no specific error was captured.',
    };
});
const renderCase = (kind, evaluationCase, buildPrompt) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const language = (_a = evaluationCase.language) !== null && _a !== void 0 ? _a : 'en';
    const payload = buildPrompt(evaluationCase.input, language);
    const promptResult = yield runPrompt(payload);
    const output = (_b = promptResult.output) !== null && _b !== void 0 ? _b : evaluationCase.simulatedOutput;
    return `## ${evaluationCase.name}
Type: ${kind}
Mode: ${promptResult.mode}
${promptResult.errorNote ? `Model note: ${promptResult.errorNote}` : ''}

### System Instruction
\`\`\`
${payload.systemInstruction}
\`\`\`

### Final Prompt
\`\`\`
${payload.prompt}
\`\`\`

### Output
\`\`\`
${output}
\`\`\`

### Review
- Readability: ${evaluationCase.review.readability}
- Ambiguity / redundancy: ${evaluationCase.review.ambiguity}
- Output format guidance: ${evaluationCase.review.formatGuidance}
- Reasoning support: ${evaluationCase.review.reasoningSupport}
- Output evaluation: ${evaluationCase.review.outputEvaluation}
`;
});
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    const sections = [
        '# AI Prompt Evaluation',
        '',
        `Generated at: ${new Date().toISOString()}`,
        `Execution mode: ${process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('replace-with-a-rotated') ? 'live Gemini with retry and simulated fallback when the API is unavailable' : 'simulated outputs (no active Gemini key configured)'}`,
        '',
        '## Review Summary',
        '- Prompts were hardened to use clearer sections, stronger formatting constraints, and explicit comparison signals.',
        '- Forecast now exposes variance vs baseline directly instead of relying on a raw trend label.',
        '- Financial health now surfaces the weakest component and main risk signals so the model can prioritize correctly.',
        '- Savings goals now include pace status and monthly gap so on-track judgments are grounded.',
        '- All prompt families now require exactly 2 plain-text sentences for more consistent UI output.',
        '- Live model execution now retries transient 429/500/503 failures and records a per-case fallback note instead of aborting the full evaluation.',
        '',
    ];
    for (const evaluationCase of forecastCases) {
        sections.push(yield renderCase('forecast', evaluationCase, ai_prompts_1.buildForecastPrompt));
    }
    for (const evaluationCase of financialHealthCases) {
        sections.push(yield renderCase('financial health', evaluationCase, ai_prompts_1.buildFinancialHealthPrompt));
    }
    for (const evaluationCase of savingsGoalCases) {
        sections.push(yield renderCase('savings goals', evaluationCase, ai_prompts_1.buildSavingsGoalPrompt));
    }
    process.stdout.write(sections.join('\n'));
});
void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
