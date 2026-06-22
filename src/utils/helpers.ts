import bunyan, { LogLevel } from 'bunyan';
import { IUserModel } from "../models";
import { CompanyTypes } from "israeli-bank-scrapers-for-e.a-servers";
import { MainTransactionType } from "./types";

export const requireEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const getEnvNumber = (key: string, fallback: number, min = 0): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.floor(value);
};

export const getEnvBoolean = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  return fallback;
};

export const getEnvString = (key: string, fallback: string): string => {
  const raw = process.env[key]?.trim();
  return raw || fallback;
};

export const MAX_LOGIN_ATTEMPTS = 5;

export enum ThemeColors {
  DARK = "dark",
  LIGHT = "light"
};

export enum Languages {
  EN = "en",
  HE = "he"
};

export enum ErrorMessages {
  NAME_IN_USE = "Name is already in use.",
  SOME_ERROR = "Some error, please contact us.",
  SOME_ERROR_TRY_AGAIN = "Some error, please try again later.",
  INCORRECT_LOGIN_ATTEMPT = "Incorrect ID or Password.",
  BANK_ACCOUNT_NOT_FOUND = "We did not found any bank account related to this ID",
  MAX_LOGIN_ATTEMPTS = "You have pass the maximum login attempts. Please try again more 24 hours..",
  INCORRECT_PASSWORD = "Email or password are incorrect",
  COMPANY_NOT_SUPPORTED = "Company not supported",
  USER_NOT_FOUND = "User not found",
  USER_ID_MISSING = "User id is missing",
  USER_BANK_ACCOUNT_NOT_FOUND = "Some error while trying to find user with this account. Please contact us.",
  CREDENTIALS_SAVED_NOT_LOADED = "Some error while trying to load saved credentials. Please contact us.",
  DECODED_CREDENTIALS_NOT_LOADED = "Some error while trying to load decoded credentials. Please contact us.",
  TOKEN_EXPIRED = "Invalid or expired token",
  GOOGLE_EMAIL_NOT_VERIFIED = "Your Google email is not verified. Please verify it with Google and try again."
};

export const SupportedCompanies = {
  [CompanyTypes.discount]: CompanyTypes.discount,
  [CompanyTypes.max]: CompanyTypes.max,
  [CompanyTypes.behatsdaa]: CompanyTypes.behatsdaa,
  [CompanyTypes.leumi]: CompanyTypes.leumi,
  [CompanyTypes.visaCal]: CompanyTypes.visaCal,
} as const;

type SupportedCompanyId = keyof typeof SupportedCompanies;

const CreditCardProviders = [
  CompanyTypes.visaCal,
  CompanyTypes.max,
  CompanyTypes.behatsdaa,
];

export enum ENV_TYPE {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
};

export interface UserBankCredentials {
  companyId: string;
  id: string;
  password: string;
  username?: string;
  num: string;
  save: boolean;
};


export const getLogger = (name: string, version: string, level: LogLevel) => {
  return bunyan.createLogger({
    name: `${name}:${version}`,
    level,
    streams: [
      {
        stream: process.stdout,
        level
      }
    ]
  });
};

export const getLogLevel = (envType: ENV_TYPE): LogLevel => {
  return envType === ENV_TYPE.DEVELOPMENT ? "debug" : "info";
};

export const isSupportedCompany = (company: string | undefined): company is SupportedCompanyId => {
  return Boolean(company && company in SupportedCompanies);
};

export const isCardProviderCompany = (company: string | undefined) => {
  if (!isSupportedCompany(company)) return false;
  return CreditCardProviders.includes(company);
};

export const getTotalTransactionsAmounts = (transactions: MainTransactionType[]): number => {
  return transactions.reduce((acc, t) => acc + t.amount, 0);
};

export const removeServicesFromUser = (user: IUserModel): IUserModel => {
  const { services, ...rest } = user.toObject();
  return rest;
}

export const isArrayAndNotEmpty = (arr: unknown): boolean => {
  return Array.isArray(arr) && arr.length > 0;
};

export const getFutureDebitDate = (dateString: string | number): number => {
  if (typeof dateString === 'string') {
    const month = parseInt(dateString?.substring(0, 2)) - 1 || 0;
    const year = parseInt(dateString?.substring(2)) || 0;
    return new Date(year, month, 1).valueOf() || 0;
  }
  return new Date(dateString).valueOf();
};
