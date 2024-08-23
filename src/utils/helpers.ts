export const MAX_LOGIN_ATTEMPTS = 5;

export enum ErrorMessages {
  SOME_ERROR = "Some error, please contact us.",
  INCORRECT_LOGIN_ATTEMPT = "Incorrect ID or Password.",
  BANK_ACCOUNT_NOT_FOUND = "We did not found any bank account related to this ID",
  MAX_LOGIN_ATTEMPTS = "You have pass the maximum login attempts. Please try again more 24 hours..",
  INCORRECT_PASSWORD = "Email or password are incorrect",
  COMPANY_NOT_SUPPORTED = "Company not supported",
  USER_NOT_FOUND = "User not found",
  USER_BANK_ACCOUNT_NOT_FOUND = "Some error while trying to find user with this account. Please contact us.",
  CREDENTIALS_SAVED_NOT_LOADED = "Some error while trying to load saved credentials. Please contact us.",
  DECODED_CREDENTIALS_NOT_LOADED = "Some error while trying to load decoded credentials. Please contact us.",
};

export const isArray = (arr: any[]): boolean => {
  return Array.isArray(arr);
};
export const isArrayAndNotEmpty = (arr: any[]): boolean => {
  return isArray(arr) && arr.length > 0;
};