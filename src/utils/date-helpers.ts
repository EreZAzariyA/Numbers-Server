const LEDGER_TIME_ZONE = 'Asia/Jerusalem';

const formatDateInTimeZone = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LEDGER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
};

export const toDateStr = (d: Date | string): string => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return formatDateInTimeZone(dt);
};

export const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export const diffDays = (a: string, b: string): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

export const daysInMonth = (year: number, monthZeroIndexed: number): number =>
  new Date(year, monthZeroIndexed + 1, 0).getDate();

export const clampDayOfMonth = (year: number, monthZeroIndexed: number, day: number): number => {
  const dim = daysInMonth(year, monthZeroIndexed);
  return Math.min(Math.max(1, day), dim);
};

export const ymd = (year: number, monthZeroIndexed: number, day: number): string => {
  const d = new Date(Date.UTC(year, monthZeroIndexed, clampDayOfMonth(year, monthZeroIndexed, day)));
  return d.toISOString().slice(0, 10);
};

export const dayOfMonth = (dateStr: string): number => new Date(dateStr).getUTCDate();
export const dayOfWeek = (dateStr: string): number => new Date(dateStr).getUTCDay();
export const monthOf = (dateStr: string): number => new Date(dateStr).getUTCMonth();
export const yearOf = (dateStr: string): number => new Date(dateStr).getUTCFullYear();

export type MonthBounds = { monthStr: string; start: string; end: string };

// Month identifier "YYYY-MM" plus first/last day strings for the given date's
// month. monthStr is UTC-based (matching existing call sites); the end day uses
// the local-time month, as the previous inline code did.
export const monthBounds = (date: Date): MonthBounds => {
  const monthStr = date.toISOString().slice(0, 7);
  const lastDay = daysInMonth(date.getFullYear(), date.getMonth());
  return {
    monthStr,
    start: `${monthStr}-01`,
    end: `${monthStr}-${String(lastDay).padStart(2, '0')}`,
  };
};
