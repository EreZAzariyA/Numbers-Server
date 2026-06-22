import type { InsightLang } from '../../models/agent-insight-model';

type Translations = {
  dailySpendingTitle: string;
  dailySpendingBody: (spent: string, avg: string) => string;
  higherThanUsualTitle: string;
  higherThanUsualBody: (overPct: string) => string;
  largeTxnTitle: string;

  weeklySpendingTitle: string;
  weeklySpendingBody: (thisWeek: string, lastWeek: string, delta: string) => string;
  spendingUpTitle: string;
  spendingUpBody: (overPct: string, thisWeek: string, lastWeek: string) => string;
  spendingDownTitle: string;
  spendingDownBody: (dropPct: string, thisWeek: string, lastWeek: string) => string;

  cashFlowRiskTitle: string;
  cashFlowRiskBody: (balance: string) => string;
  monthUnderPressureTitle: string;
  monthUnderPressureBody: (balance: string) => string;
  monthOnTrackTitle: string;
  monthOnTrackBody: (balance: string) => string;

  priceIncreaseTitle: (name: string) => string;
  priceIncreaseBody: (current: string, previous: string, changePct: string) => string;
  upcomingRenewalTitle: (description: string) => string;
  upcomingRenewalBody: (amount: string, date: string, days: number) => string;
  subscriptionsStableTitle: string;
  subscriptionsStableBody: string;
  subDataUnavailableTitle: string;
  subDataUnavailableBody: (msg: string) => string;

  incomeThisMonthTitle: string;
  incomeThisMonthBody: (income: string) => string;
  noIncomeTitle: string;
  noIncomeBody: string;
  incomeUpTitle: string;
  incomeUpBody: (current: string, prior: string, changePct: string) => string;
  incomeDownTitle: string;
  incomeDownBody: (current: string, prior: string, dropPct: string) => string;

  unusualSpendTitle: (merchant: string) => string;
  unusualSpendBody: (spent: string, baseline: string) => string;
  duplicateChargeTitle: (merchant: string) => string;
  duplicateChargeBody: (amount: string, count: number) => string;
  noAnomaliesTitle: string;
  noAnomaliesBody: string;

  analysisUnavailableTitle: string;
  dailyUnavailableBody: (msg: string) => string;
  weeklyUnavailableBody: (msg: string) => string;
  monthRiskUnavailableBody: (msg: string) => string;
  subscriptionUnavailableBody: (msg: string) => string;
  incomeUnavailableBody: (msg: string) => string;
  anomalyUnavailableBody: (msg: string) => string;
};

const en: Translations = {
  dailySpendingTitle: 'Daily spending summary',
  dailySpendingBody: (spent, avg) => `Spent ₪${spent} yesterday (30-day daily average: ₪${avg}).`,
  higherThanUsualTitle: 'Higher than usual day',
  higherThanUsualBody: (overPct) => `Yesterday's spend was ${overPct}% above your daily average.`,
  largeTxnTitle: 'Large transaction',

  weeklySpendingTitle: 'Weekly spending',
  weeklySpendingBody: (thisWeek, lastWeek, delta) =>
    `This week: ₪${thisWeek} vs last week: ₪${lastWeek} (${delta}).`,
  spendingUpTitle: 'Spending up this week',
  spendingUpBody: (overPct, thisWeek, lastWeek) =>
    `This week's spending is ${overPct}% higher than last week (₪${thisWeek} vs ₪${lastWeek}).`,
  spendingDownTitle: 'Spending down this week',
  spendingDownBody: (dropPct, thisWeek, lastWeek) =>
    `This week's spending is ${dropPct}% lower than last week (₪${thisWeek} vs ₪${lastWeek}).`,

  cashFlowRiskTitle: 'Cash flow risk',
  cashFlowRiskBody: (balance) => `Projected month-end balance: ${balance}. Risk level: high.`,
  monthUnderPressureTitle: 'Month-end under pressure',
  monthUnderPressureBody: (balance) => `Projected balance: ${balance}. Watch spending this week.`,
  monthOnTrackTitle: 'Month on track',
  monthOnTrackBody: (balance) => `Projected month-end balance: ${balance}.`,

  priceIncreaseTitle: (name) => `Price increase: ${name}`,
  priceIncreaseBody: (current, previous, changePct) =>
    `Now ₪${current} (was ₪${previous}, +${changePct}%).`,
  upcomingRenewalTitle: (description) => `Upcoming renewal: ${description}`,
  upcomingRenewalBody: (amount, date, days) =>
    `₪${amount} expected on ${date} (in ${days} day(s)).`,
  subscriptionsStableTitle: 'Subscriptions stable',
  subscriptionsStableBody: 'No significant subscription changes detected.',
  subDataUnavailableTitle: 'Subscription data unavailable',
  subDataUnavailableBody: (msg) => `Could not load subscription data: ${msg}`,

  incomeThisMonthTitle: 'Income this month',
  incomeThisMonthBody: (income) => `Received ₪${income} in income so far this month.`,
  noIncomeTitle: 'No income detected',
  noIncomeBody: 'You had income last month but none detected yet this month.',
  incomeUpTitle: 'Income up',
  incomeUpBody: (current, prior, changePct) =>
    `Income ₪${current} this month vs ₪${prior} last month (+${changePct}%).`,
  incomeDownTitle: 'Income down',
  incomeDownBody: (current, prior, dropPct) =>
    `Income ₪${current} this month vs ₪${prior} last month (-${dropPct}%).`,

  unusualSpendTitle: (merchant) => `Unusual spend at ${merchant}`,
  unusualSpendBody: (spent, baseline) =>
    `₪${spent} this month vs a ₪${baseline} monthly average.`,
  duplicateChargeTitle: (merchant) => `Possible duplicate charge at ${merchant}`,
  duplicateChargeBody: (amount, count) =>
    `₪${amount} appears ${count} time(s) within 48 hours.`,
  noAnomaliesTitle: 'No anomalies detected',
  noAnomaliesBody: 'Spending looks normal this month.',

  analysisUnavailableTitle: 'Analysis unavailable',
  dailyUnavailableBody: (msg) => `Daily expense review could not complete: ${msg}`,
  weeklyUnavailableBody: (msg) => `Weekly summary could not complete: ${msg}`,
  monthRiskUnavailableBody: (msg) => `Month-end risk analysis could not complete: ${msg}`,
  subscriptionUnavailableBody: (msg) => `Subscription watch could not complete: ${msg}`,
  incomeUnavailableBody: (msg) => `Income detection could not complete: ${msg}`,
  anomalyUnavailableBody: (msg) => `Anomaly detection could not complete: ${msg}`,
};

const he: Translations = {
  dailySpendingTitle: 'סיכום הוצאות יומי',
  dailySpendingBody: (spent, avg) =>
    `הוצאת ₪${spent} אתמול (ממוצע יומי ל-30 יום: ₪${avg}).`,
  higherThanUsualTitle: 'יום עם הוצאה גבוהה מהרגיל',
  higherThanUsualBody: (overPct) =>
    `ההוצאה אתמול הייתה ${overPct}% מעל הממוצע היומי שלך.`,
  largeTxnTitle: 'עסקה גדולה',

  weeklySpendingTitle: 'הוצאות שבועיות',
  weeklySpendingBody: (thisWeek, lastWeek, delta) =>
    `השבוע: ₪${thisWeek} לעומת שבוע שעבר: ₪${lastWeek} (${delta}).`,
  spendingUpTitle: 'עלייה בהוצאות השבוע',
  spendingUpBody: (overPct, thisWeek, lastWeek) =>
    `ההוצאה השבוע גבוהה ב-${overPct}% מהשבוע שעבר (₪${thisWeek} לעומת ₪${lastWeek}).`,
  spendingDownTitle: 'ירידה בהוצאות השבוע',
  spendingDownBody: (dropPct, thisWeek, lastWeek) =>
    `ההוצאה השבוע נמוכה ב-${dropPct}% מהשבוע שעבר (₪${thisWeek} לעומת ₪${lastWeek}).`,

  cashFlowRiskTitle: 'סיכון תזרים מזומנים',
  cashFlowRiskBody: (balance) =>
    `יתרה חזויה לסוף החודש: ${balance}. רמת סיכון: גבוהה.`,
  monthUnderPressureTitle: 'לחץ בסוף החודש',
  monthUnderPressureBody: (balance) =>
    `יתרה חזויה: ${balance}. שים לב להוצאות השבוע.`,
  monthOnTrackTitle: 'החודש במסלול',
  monthOnTrackBody: (balance) => `יתרה חזויה לסוף החודש: ${balance}.`,

  priceIncreaseTitle: (name) => `עלייה במחיר: ${name}`,
  priceIncreaseBody: (current, previous, changePct) =>
    `כעת ₪${current} (היה ₪${previous}, +${changePct}%).`,
  upcomingRenewalTitle: (description) => `חידוש קרוב: ${description}`,
  upcomingRenewalBody: (amount, date, days) =>
    `₪${amount} צפוי ב-${date} (עוד ${days} ימים).`,
  subscriptionsStableTitle: 'מנויים יציבים',
  subscriptionsStableBody: 'לא זוהו שינויים משמעותיים במנויים.',
  subDataUnavailableTitle: 'נתוני מנויים לא זמינים',
  subDataUnavailableBody: (msg) => `לא ניתן לטעון נתוני מנויים: ${msg}`,

  incomeThisMonthTitle: 'הכנסה החודש',
  incomeThisMonthBody: (income) => `התקבלו ₪${income} כהכנסה עד כה החודש.`,
  noIncomeTitle: 'לא זוהתה הכנסה',
  noIncomeBody: 'הייתה לך הכנסה בחודש שעבר, אך לא זוהתה הכנסה עד כה החודש.',
  incomeUpTitle: 'עלייה בהכנסה',
  incomeUpBody: (current, prior, changePct) =>
    `הכנסה ₪${current} החודש לעומת ₪${prior} בחודש שעבר (+${changePct}%).`,
  incomeDownTitle: 'ירידה בהכנסה',
  incomeDownBody: (current, prior, dropPct) =>
    `הכנסה ₪${current} החודש לעומת ₪${prior} בחודש שעבר (-${dropPct}%).`,

  unusualSpendTitle: (merchant) => `הוצאה חריגה ב-${merchant}`,
  unusualSpendBody: (spent, baseline) =>
    `₪${spent} החודש לעומת ממוצע חודשי של ₪${baseline}.`,
  duplicateChargeTitle: (merchant) => `חיוב כפול אפשרי ב-${merchant}`,
  duplicateChargeBody: (amount, count) =>
    `₪${amount} מופיע ${count} פעמים תוך 48 שעות.`,
  noAnomaliesTitle: 'לא זוהו חריגות',
  noAnomaliesBody: 'ההוצאות נראות תקינות החודש.',

  analysisUnavailableTitle: 'הניתוח אינו זמין',
  dailyUnavailableBody: (msg) => `סקירת הוצאות יומיות לא הסתיימה: ${msg}`,
  weeklyUnavailableBody: (msg) => `הסיכום השבועי לא הסתיים: ${msg}`,
  monthRiskUnavailableBody: (msg) => `ניתוח סיכון סוף חודש לא הסתיים: ${msg}`,
  subscriptionUnavailableBody: (msg) => `מעקב מנויים לא הסתיים: ${msg}`,
  incomeUnavailableBody: (msg) => `זיהוי הכנסות לא הסתיים: ${msg}`,
  anomalyUnavailableBody: (msg) => `זיהוי חריגות לא הסתיים: ${msg}`,
};

export const i18n: Record<InsightLang, Translations> = { en, he };
