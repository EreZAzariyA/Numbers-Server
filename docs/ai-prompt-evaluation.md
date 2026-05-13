
> server@1.0.0 prompt:evaluate
> ts-node scripts/evaluate-ai-prompts.ts

# AI Prompt Evaluation

Generated at: 2026-04-17T08:15:47.115Z
Execution mode: live Gemini with retry and simulated fallback when the API is unavailable

## Review Summary
- Prompts were hardened to use clearer sections, stronger formatting constraints, and explicit comparison signals.
- Forecast now exposes variance vs baseline directly instead of relying on a raw trend label.
- Financial health now surfaces the weakest component and main risk signals so the model can prioritize correctly.
- Savings goals now include pace status and monthly gap so on-track judgments are grounded.
- All prompt families now require exactly 2 plain-text sentences for more consistent UI output.
- Live model execution now retries transient 429/500/503 failures and records a per-case fallback note instead of aborting the full evaluation.

## Forecast Case 1: Mid-month overspending
Type: forecast
Mode: simulated output
Model note: Gemini returned an invalid response: Gemini returned an unexpectedly short response (33 chars).

### System Instruction
```
You are a personal finance assistant. Respond in English. Produce exactly 2 complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must state whether projected spending is above, below, or roughly in line with the baseline and what that means for this month's budget. Sentence 2 must give one specific action the user can take before month end. Base every claim only on the provided data. Do not invent causes, categories, or missing context. Mention at most 2 numbers in the answer and avoid repeating the same number twice. Do not start the answer with a currency symbol or an isolated number. End both sentences normally.
```

### Final Prompt
```
Forecast summary
Period context:
- Days elapsed: 17
- Total days in month: 30
- Days remaining: 13

Baseline:
- Complete historical months analyzed: 6
- Historical monthly spend: 2025-10=₪6840.25 | 2025-11=₪7015.40 | 2025-12=₪7348.90 | 2026-01=₪6922.15 | 2026-02=₪7188.55 | 2026-03=₪7029.80
- Average monthly spend baseline: ₪7057.51

Current month:
- Spend so far: ₪5120.65
- Projected end-of-month spend: ₪9036.44
- Difference vs baseline: +1978.93 (28.0% above)
- Trend classification: Up

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: state whether projected spending is above, below, or near the baseline and what that implies for the budget.
- Sentence 2: give one concrete action for the rest of this month.

Rules:
- Use only the data above.
- Focus on the projected end-of-month outcome, not the raw daily average.
- Do not speculate about categories or reasons that are not stated.
- Do not start the answer with a number or currency symbol.
- Keep the tone concise, practical, and specific.
```

### Output
```
Projected spending is running well above your recent baseline, which puts this month at real risk of finishing over budget. Reduce discretionary spending for the remaining days and review any large planned purchases before they post.
```

### Review
- Readability: Clear sections separate the baseline from the current month and make the main comparison easy to scan.
- Ambiguity / redundancy: Trend labels are supported by an explicit delta and percentage, so "up" is no longer vague on its own.
- Output format guidance: The prompt now requires exactly 2 sentences, plain text, one comparison sentence and one action sentence.
- Reasoning support: The baseline, projected total, and variance are all present, so the model has the minimum data needed to reason about budget pressure.
- Output evaluation: The simulated response follows the 2-sentence format, uses the overspending signal correctly, and gives a specific short-term action.

## Forecast Case 2: Spending comfortably below baseline
Type: forecast
Mode: simulated output
Model note: Gemini returned an invalid response: Gemini returned an unexpectedly short response (54 chars).

### System Instruction
```
You are a personal finance assistant. Respond in English. Produce exactly 2 complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must state whether projected spending is above, below, or roughly in line with the baseline and what that means for this month's budget. Sentence 2 must give one specific action the user can take before month end. Base every claim only on the provided data. Do not invent causes, categories, or missing context. Mention at most 2 numbers in the answer and avoid repeating the same number twice. Do not start the answer with a currency symbol or an isolated number. End both sentences normally.
```

### Final Prompt
```
Forecast summary
Period context:
- Days elapsed: 17
- Total days in month: 30
- Days remaining: 13

Baseline:
- Complete historical months analyzed: 6
- Historical monthly spend: 2025-10=₪9422.70 | 2025-11=₪9798.45 | 2025-12=₪10122.80 | 2026-01=₪9566.95 | 2026-02=₪9311.30 | 2026-03=₪9733.55
- Average monthly spend baseline: ₪9659.29

Current month:
- Spend so far: ₪3815.90
- Projected end-of-month spend: ₪6733.94
- Difference vs baseline: -2925.35 (30.3% below)
- Trend classification: Down

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: state whether projected spending is above, below, or near the baseline and what that implies for the budget.
- Sentence 2: give one concrete action for the rest of this month.

Rules:
- Use only the data above.
- Focus on the projected end-of-month outcome, not the raw daily average.
- Do not speculate about categories or reasons that are not stated.
- Do not start the answer with a number or currency symbol.
- Keep the tone concise, practical, and specific.
```

### Output
```
Projected spending is materially below your recent baseline, which suggests this month is tracking with more budget headroom than usual. Lock in that advantage by keeping variable spending restrained and directing any leftover room toward savings or debt reduction.
```

### Review
- Readability: The structure is still easy to read even when the signal is positive instead of negative.
- Ambiguity / redundancy: The phrase "below baseline" is grounded by an explicit signed difference and percentage.
- Output format guidance: The two-sentence rule remains strong and prevents the model from turning the answer into a mini-report.
- Reasoning support: The prompt gives enough context for the model to distinguish genuine underspending from incomplete month data.
- Output evaluation: The simulated response is grounded in the provided numbers and keeps the advice specific instead of generic praise.

## Forecast Case 3: Near baseline / flat trend
Type: forecast
Mode: simulated output
Model note: Gemini request failed after 4 attempt(s): status 429: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. 
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-2.5-flash
Please retry in 58.055671916s. [{"@type":"type.googleapis.com/google.rpc.Help","links":[{"description":"Learn more about Gemini API quotas","url":"https://ai.google.dev/gemini-api/docs/rate-limits"}]},{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaDimensions":{"model":"gemini-2.5-flash","location":"global"},"quotaValue":"5"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"58s"}]

### System Instruction
```
You are a personal finance assistant. Respond in English. Produce exactly 2 complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must state whether projected spending is above, below, or roughly in line with the baseline and what that means for this month's budget. Sentence 2 must give one specific action the user can take before month end. Base every claim only on the provided data. Do not invent causes, categories, or missing context. Mention at most 2 numbers in the answer and avoid repeating the same number twice. Do not start the answer with a currency symbol or an isolated number. End both sentences normally.
```

### Final Prompt
```
Forecast summary
Period context:
- Days elapsed: 17
- Total days in month: 30
- Days remaining: 13

Baseline:
- Complete historical months analyzed: 6
- Historical monthly spend: 2025-10=₪8120.40 | 2025-11=₪8248.15 | 2025-12=₪7988.95 | 2026-01=₪8355.60 | 2026-02=₪8064.75 | 2026-03=₪8199.20
- Average monthly spend baseline: ₪8162.84

Current month:
- Spend so far: ₪4595.35
- Projected end-of-month spend: ₪8109.44
- Difference vs baseline: -53.40 (0.7% below)
- Trend classification: Flat

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: state whether projected spending is above, below, or near the baseline and what that implies for the budget.
- Sentence 2: give one concrete action for the rest of this month.

Rules:
- Use only the data above.
- Focus on the projected end-of-month outcome, not the raw daily average.
- Do not speculate about categories or reasons that are not stated.
- Do not start the answer with a number or currency symbol.
- Keep the tone concise, practical, and specific.
```

### Output
```
Projected spending is roughly in line with your normal monthly pattern, so the budget is stable for now rather than moving sharply in either direction. Keep watching discretionary purchases through month end so the month stays close to baseline instead of drifting upward.
```

### Review
- Readability: The prompt remains readable when the answer should be neutral rather than strongly positive or negative.
- Ambiguity / redundancy: The flat case is strengthened by a near-zero variance field rather than relying on the label alone.
- Output format guidance: The output format is explicit enough to keep the model from overexplaining a neutral case.
- Reasoning support: The prompt includes the exact comparison needed to justify a stable assessment.
- Output evaluation: The simulated response stays grounded and does not invent urgency where the numbers do not support it.

## Financial Health Case 1: Strong overall position
Type: financial health
Mode: simulated output
Model note: Gemini request failed after 4 attempt(s): status 429: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. 
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-2.5-flash
Please retry in 46.753594606s. [{"@type":"type.googleapis.com/google.rpc.Help","links":[{"description":"Learn more about Gemini API quotas","url":"https://ai.google.dev/gemini-api/docs/rate-limits"}]},{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaDimensions":{"model":"gemini-2.5-flash","location":"global"},"quotaValue":"5"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"46s"}]

### System Instruction
```
You are a personal finance assistant. Respond in English. Produce exactly 2 complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must identify the main driver of the score and what it means for the user's financial position. Sentence 2 must give one specific next action that targets the biggest risk. Use only the provided data. Do not summarize every component, do not invent causes, and mention no more than 3 numbers in the answer. Do not start the answer with a number or a score. End both sentences normally.
```

### Final Prompt
```
Financial health summary
Overall:
- Score: 86/100
- Status: Good

Components:
- Cash flow: Net +4,200 this month (score 100/100, status good)
- Category budgets: All 5 budget limits within range (score 100/100, status good)
- Savings trend: Net positive savings (flat trend) (score 70/100, status good)
- Debt pressure: Loan payments are 34% of income (score 55/100, status warning)

Priority signals:
- Weakest component: Debt pressure (55/100)
- Main risk signals: Debt pressure, Savings trend

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: explain the main reason the overall score is good and what that means.
- Sentence 2: give one concrete action that addresses the biggest risk first.

Rules:
- Use only the data above.
- Focus on the most important negative or limiting signal, not every component.
- Do not repeat the full score breakdown in the answer.
- Do not start the answer with a number, score, or percentage.
- Keep the advice practical and specific.
```

### Output
```
Your score is strong because cash flow is healthy and budget controls are holding, which offsets the moderate debt burden. Keep the momentum by directing part of this month’s surplus to debt reduction so the balance sheet improves without straining cash flow.
```

### Review
- Readability: The overall score, component details, and priority signals are separated cleanly, so the model can identify the driver quickly.
- Ambiguity / redundancy: Weakest-component labeling removes guesswork about which signal should dominate the explanation.
- Output format guidance: Exactly 2 sentences plus a “biggest risk first” rule makes the response style more predictable.
- Reasoning support: The score, status, and each component’s detail provide enough evidence to justify a balanced interpretation.
- Output evaluation: The simulated response correctly balances strong performance with one constrained action instead of reciting all four components.

## Financial Health Case 2: Warning due to deficit and debt load
Type: financial health
Mode: simulated output
Model note: Gemini request failed after 4 attempt(s): status 429: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. 
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-2.5-flash
Please retry in 35.522591486s. [{"@type":"type.googleapis.com/google.rpc.Help","links":[{"description":"Learn more about Gemini API quotas","url":"https://ai.google.dev/gemini-api/docs/rate-limits"}]},{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaDimensions":{"model":"gemini-2.5-flash","location":"global"},"quotaValue":"5"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"35s"}]

### System Instruction
```
You are a personal finance assistant. Respond in English. Produce exactly 2 complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must identify the main driver of the score and what it means for the user's financial position. Sentence 2 must give one specific next action that targets the biggest risk. Use only the provided data. Do not summarize every component, do not invent causes, and mention no more than 3 numbers in the answer. Do not start the answer with a number or a score. End both sentences normally.
```

### Final Prompt
```
Financial health summary
Overall:
- Score: 43/100
- Status: Warning

Components:
- Cash flow: Deficit of 3,150 this month (score 20/100, status bad)
- Category budgets: 1 budget limit exceeded this month (score 65/100, status warning)
- Savings trend: Mixed trend — last month was positive (score 55/100, status warning)
- Debt pressure: High debt load: 52% of income (score 20/100, status bad)

Priority signals:
- Weakest component: Cash flow (20/100)
- Main risk signals: Cash flow, Debt pressure

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: explain the main reason the overall score is warning and what that means.
- Sentence 2: give one concrete action that addresses the biggest risk first.

Rules:
- Use only the data above.
- Focus on the most important negative or limiting signal, not every component.
- Do not repeat the full score breakdown in the answer.
- Do not start the answer with a number, score, or percentage.
- Keep the advice practical and specific.
```

### Output
```
The score is weak mainly because the month is running at a deficit while debt payments already consume a heavy share of income, leaving very little room for error. Prioritize cutting or delaying variable spending immediately so more income is available to cover fixed debt obligations.
```

### Review
- Readability: The prompt makes the two main negative signals visible in both the component list and the priority section.
- Ambiguity / redundancy: The “main risk signals” field reduces the chance that the model latches onto a less important warning.
- Output format guidance: The answer constraints are strict enough to prevent a four-component recap.
- Reasoning support: The combination of deficit detail and debt ratio gives the model a concrete basis for identifying the dominant risk.
- Output evaluation: The simulated response is grounded in the worst signals and gives a direct action tied to the actual risk profile.

## Financial Health Case 3: Bad due to broad-based weakness
Type: financial health
Mode: simulated output
Model note: Gemini request failed after 4 attempt(s): status 429: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. 
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-2.5-flash
Please retry in 24.418965989s. [{"@type":"type.googleapis.com/google.rpc.Help","links":[{"description":"Learn more about Gemini API quotas","url":"https://ai.google.dev/gemini-api/docs/rate-limits"}]},{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaDimensions":{"location":"global","model":"gemini-2.5-flash"},"quotaValue":"5"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"24s"}]

### System Instruction
```
You are a personal finance assistant. Respond in English. Produce exactly 2 complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must identify the main driver of the score and what it means for the user's financial position. Sentence 2 must give one specific next action that targets the biggest risk. Use only the provided data. Do not summarize every component, do not invent causes, and mention no more than 3 numbers in the answer. Do not start the answer with a number or a score. End both sentences normally.
```

### Final Prompt
```
Financial health summary
Overall:
- Score: 24/100
- Status: Bad

Components:
- Cash flow: Deficit of 5,980 this month (score 20/100, status bad)
- Category budgets: 3 budget limits exceeded this month (score 10/100, status bad)
- Savings trend: Spending exceeded income in recent months (score 15/100, status bad)
- Debt pressure: Loan payments are 41% of income (score 55/100, status warning)

Priority signals:
- Weakest component: Category budgets (10/100)
- Main risk signals: Category budgets, Savings trend

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: explain the main reason the overall score is bad and what that means.
- Sentence 2: give one concrete action that addresses the biggest risk first.

Rules:
- Use only the data above.
- Focus on the most important negative or limiting signal, not every component.
- Do not repeat the full score breakdown in the answer.
- Do not start the answer with a number, score, or percentage.
- Keep the advice practical and specific.
```

### Output
```
The score is poor because overspending is happening on multiple fronts at once, with budget overruns and recent negative savings trends reinforcing a large monthly deficit. Freeze non-essential spending and rebuild control around the categories that are already over limit before taking on any new discretionary commitments.
```

### Review
- Readability: The prompt gives a compact but sufficiently rich view of the weak signals without noise from unrelated metrics.
- Ambiguity / redundancy: The explicit weakest-component line helps the model identify that category control is the sharpest failure point.
- Output format guidance: The constraints continue to push a short explanation plus one action rather than a generic lecture.
- Reasoning support: The score and detailed component text support a grounded interpretation of broad-based weakness.
- Output evaluation: The simulated response does not hallucinate missing categories and keeps the action anchored to overspending control.

## Savings Goal Case 1: On track for home down payment
Type: savings goals
Mode: simulated output
Model note: Gemini returned an invalid response: Gemini returned an unexpectedly short response (35 chars).

### System Instruction
```
You are a personal finance assistant. Respond in English. Produce exactly 2 short complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must say whether the user is on track, slightly behind, or far behind based on the savings pace. Sentence 2 must give one specific action to close the gap. Use only the data provided. Do not invent income sources, expense categories, or personal circumstances. Mention no more than 3 numbers in the answer. Do not start the answer with a number, percentage, or currency symbol. End both sentences normally.
```

### Final Prompt
```
Savings goal summary
- Goal: "Home down payment"
- Target amount: ₪120000.00
- Current saved: ₪46000.00
- Progress: 38%
- Deadline: 2027-06-01
- Months remaining: 14
- Amount remaining: ₪74000.00
- Required monthly savings: ₪5285.71
- Average monthly net savings: ₪6100.35
- Monthly pace gap vs target: +814.64
- Pace status: On track

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: say whether the user is on track, slightly behind, or far behind using the pace gap.
- Sentence 2: give one concrete action that would help close the gap.

Rules:
- Use only the data above.
- Be specific and practical, not generic.
- Do not restate every number from the prompt.
- Do not start the answer with a number, percentage, or currency symbol.
- Do not give encouragement that is not supported by the data.
```

### Output
```
You are on track because your recent monthly savings pace is already above what this goal requires by the deadline. Keep routing that surplus into the goal automatically each month so progress stays steady and you avoid slipping later.
```

### Review
- Readability: The prompt lays out the target, current progress, deadline, and pace comparison in a clean sequence.
- Ambiguity / redundancy: The explicit pace status and monthly gap remove ambiguity about whether the user is truly on track.
- Output format guidance: Exactly 2 short sentences keeps the answer compact and consistent across goals.
- Reasoning support: The required pace and actual pace are the key signals for this reasoning task, and both are present.
- Output evaluation: The simulated response is grounded and specific without inventing extra financial context.

## Savings Goal Case 2: Emergency fund is falling behind
Type: savings goals
Mode: simulated output
Model note: Gemini returned an invalid response: Gemini returned an unexpectedly short response (38 chars).

### System Instruction
```
You are a personal finance assistant. Respond in English. Produce exactly 2 short complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must say whether the user is on track, slightly behind, or far behind based on the savings pace. Sentence 2 must give one specific action to close the gap. Use only the data provided. Do not invent income sources, expense categories, or personal circumstances. Mention no more than 3 numbers in the answer. Do not start the answer with a number, percentage, or currency symbol. End both sentences normally.
```

### Final Prompt
```
Savings goal summary
- Goal: "Emergency fund"
- Target amount: ₪18000.00
- Current saved: ₪7400.00
- Progress: 41%
- Deadline: 2026-11-01
- Months remaining: 7
- Amount remaining: ₪10600.00
- Required monthly savings: ₪1514.29
- Average monthly net savings: ₪980.40
- Monthly pace gap vs target: -533.89
- Pace status: Far behind

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: say whether the user is on track, slightly behind, or far behind using the pace gap.
- Sentence 2: give one concrete action that would help close the gap.

Rules:
- Use only the data above.
- Be specific and practical, not generic.
- Do not restate every number from the prompt.
- Do not start the answer with a number, percentage, or currency symbol.
- Do not give encouragement that is not supported by the data.
```

### Output
```
You are far behind because your recent monthly savings pace is below what this goal needs to reach the target date. Increase the amount going into this fund each month or push the deadline back so the target matches your real saving capacity.
```

### Review
- Readability: The pace gap and pace status fields surface the decision-critical signal immediately.
- Ambiguity / redundancy: The model no longer has to infer “behind” from separate values because the pace comparison is explicit.
- Output format guidance: The short-sentence requirement reduces the chance of generic motivational language.
- Reasoning support: Required pace, current pace, and deadline are enough to support a grounded on-track judgment.
- Output evaluation: The simulated response follows the required format and addresses the exact shortfall instead of offering vague savings advice.

## Savings Goal Case 3: Vacation fund slightly behind but recoverable
Type: savings goals
Mode: simulated output
Model note: Gemini returned an invalid response: Gemini returned an unexpectedly short response (41 chars).

### System Instruction
```
You are a personal finance assistant. Respond in English. Produce exactly 2 short complete sentences in plain text, with no bullets, headings, or markdown. Sentence 1 must say whether the user is on track, slightly behind, or far behind based on the savings pace. Sentence 2 must give one specific action to close the gap. Use only the data provided. Do not invent income sources, expense categories, or personal circumstances. Mention no more than 3 numbers in the answer. Do not start the answer with a number, percentage, or currency symbol. End both sentences normally.
```

### Final Prompt
```
Savings goal summary
- Goal: "Family vacation"
- Target amount: ₪24000.00
- Current saved: ₪16800.00
- Progress: 70%
- Deadline: 2026-12-01
- Months remaining: 8
- Amount remaining: ₪7200.00
- Required monthly savings: ₪900.00
- Average monthly net savings: ₪805.50
- Monthly pace gap vs target: -94.50
- Pace status: Slightly behind

Task:
Write exactly 2 sentences in plain text.
- Sentence 1: say whether the user is on track, slightly behind, or far behind using the pace gap.
- Sentence 2: give one concrete action that would help close the gap.

Rules:
- Use only the data above.
- Be specific and practical, not generic.
- Do not restate every number from the prompt.
- Do not start the answer with a number, percentage, or currency symbol.
- Do not give encouragement that is not supported by the data.
```

### Output
```
You are slightly behind because your current savings pace is close to the target but still not enough to fully cover the remaining amount by the deadline. Add a modest monthly increase to this goal now so the shortfall does not compound over the final stretch.
```

### Review
- Readability: The case remains readable even when the signal is borderline rather than clearly on track or clearly behind.
- Ambiguity / redundancy: The distinction between “slightly behind” and “far behind” is supported by the explicit pace gap rule.
- Output format guidance: The prompt strongly steers the model into one status sentence and one action sentence.
- Reasoning support: The answer can be grounded directly in the narrow gap between required and actual pace.
- Output evaluation: The simulated response is specific and avoids overstating the severity of the problem.
