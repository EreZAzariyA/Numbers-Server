import { CompanyTypes, ScraperCredentials } from "israeli-bank-scrapers";
import { UserBankCredentialModel } from "../bll/bank-logic";
import ClientError from "../models/client-error";
import { ErrorMessages } from "./helpers";

export const SupportedCompanies = {
  [CompanyTypes.discount]: CompanyTypes.discount,
  [CompanyTypes.max]: CompanyTypes.max,
  [CompanyTypes.behatsdaa]: CompanyTypes.behatsdaa,
  [CompanyTypes.leumi]: CompanyTypes.leumi
};

export const createCredentials = (details: UserBankCredentialModel): ScraperCredentials => {
  if (!SupportedCompanies[details.companyId]) {
    throw new ClientError(500, `${ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
  }

  let credentials: ScraperCredentials;

  switch (details.companyId) {
    case SupportedCompanies.discount:
      credentials = {
        id: details.id,
        password: details.password,
        num: details.num
      };
    break;
    case SupportedCompanies.max:
      credentials = {
        username: details.username,
        password: details.password
      };
    break;
  };

  return credentials;
}