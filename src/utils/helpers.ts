import { CompanyTypes } from "israeli-bank-scrapers";

export const MAX_LOGIN_ATTEMPTS = 5;

export enum ErrorMessages {
  MAX_LOGIN_ATTEMPTS = "You have pass the maximum login attempts. Please try again more 24 hours..",
  INCORRECT_PASSWORD = "Email or password are incorrect"
}

export enum SupportedCompanies {
  discount = 'discount',
  behatsdaa = 'behatsdaa'
};