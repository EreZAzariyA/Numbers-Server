export const toDateStr = (d: Date | string): string => {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
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
