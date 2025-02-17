import moment from "moment";
import { IUserModel } from "../models/user-model";

export const MAX_LOGIN_ATTEMPTS = 5;

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

export const removeServicesFromUser = (user: IUserModel): IUserModel => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { services, ...rest } = user.toObject();
  return rest;
}

export const isArray = (arr: any[]): boolean => {
  return Array.isArray(arr);
};
export const isArrayAndNotEmpty = (arr: any[]): boolean => {
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