import { SupportedLanguage } from './tool-types';

export const TRANSACTION_SOURCE_ENUM = ['account-transactions', 'card-transactions'];
export const TRANSACTION_FILTER_ENUM = ['all', ...TRANSACTION_SOURCE_ENUM];

export const roundAmount = (value: number): number => Math.round((value || 0) * 100) / 100;

export const startOfMonth = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}-01`;

export const endOfMonth = (year: number, month: number): string => {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};

const addOneDay = (date: string): string => {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

export const buildInclusiveDateRangeFilter = (start: string, end: string): Record<string, string> => ({
  $gte: start,
  $lt: addOneDay(end),
});

export const addMonths = (year: number, month: number, delta: number): { year: number; month: number } => {
  const current = new Date(year, month - 1 + delta, 1);
  return { year: current.getFullYear(), month: current.getMonth() + 1 };
};

export const formatDateWindow = (start: string, end: string): string =>
  `${start.slice(0, 10)} to ${end.slice(0, 10)}`;

export const localize = (language: SupportedLanguage, en: string, he: string): string =>
  language === 'he' ? he : en;
