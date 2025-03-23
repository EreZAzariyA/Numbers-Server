import moment from "moment";
import bunyan, { LogLevel } from 'bunyan';
import { IUserModel } from "../models";
import { CompanyTypes } from "israeli-bank-scrapers-for-e.a-servers";
import { MainTransactionType } from "./types";

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
  TOKEN_EXPIRED = "Invalid or expired token"
};

export const SupportedCompanies = {
  [CompanyTypes.discount]: CompanyTypes.discount,
  [CompanyTypes.max]: CompanyTypes.max,
  [CompanyTypes.behatsdaa]: CompanyTypes.behatsdaa,
  [CompanyTypes.leumi]: CompanyTypes.leumi,
  [CompanyTypes.visaCal]: CompanyTypes.visaCal,
};

export const CreditCardProviders = [
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

export const isCardProviderCompany = (company: string) => {
  return CreditCardProviders.includes(CompanyTypes[company]) || false;
};

export const getTotalTransactionsAmounts = (transactions: MainTransactionType[]): number => {
  return transactions.reduce((acc, t) => acc + t.amount, 0);
};

export const removeServicesFromUser = (user: IUserModel): IUserModel => {
  const { services, ...rest } = user.toObject();
  return rest;
}

export const isArray = (arr: []): boolean => {
  return Array.isArray(arr);
};
export const isArrayAndNotEmpty = (arr: any): boolean => {
  return isArray(arr) && arr.length > 0;
};

export const getFutureDebitDate = (dateString: string | number): number => {
  if (typeof dateString === 'string') {
    const month = parseInt(dateString?.substring(0, 2)) - 1 || 0;
    const year = parseInt(dateString?.substring(2)) || 0;
    return new Date(year, month, 1).valueOf() || 0;
  }
  return moment(dateString).valueOf()
};

export const asNumString = (num: number = 0, digits: number = 2): string => {
  if (!num || typeof num !== 'number') {
    return '0'
  }
  const formattedNumber = num?.toFixed(digits);
  return parseFloat(formattedNumber || '0').toLocaleString();
};