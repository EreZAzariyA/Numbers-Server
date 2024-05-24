import moment from "moment";
import { CompanyTypes, ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers";
import { UserBankCredentialModel } from "../bll/bank-logic";
import ClientError from "../models/client-error";
import { ErrorMessages } from "./helpers";
import { TransactionsAccount } from "israeli-bank-scrapers/lib/transactions";
import jwt from "./jwt";
import { BalanceHistoryModel } from "../models/user-model";

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
};

export const getBankData = async (details: UserBankCredentialModel): Promise<ScraperScrapingResult> => {
  const lastYear = moment().subtract('1', 'years').calendar();

  const options: ScraperOptions = {
    companyId: CompanyTypes[details.companyId],
    startDate: new Date(lastYear),
    combineInstallments: false,
    showBrowser: false,
    defaultTimeout: 10000
  };

  const credentials = createCredentials(details);

  const scraper = createScraper(options);
  const scrapeResult = await scraper.scrape(credentials);
  return scrapeResult;
};

export const createQuery = (account: TransactionsAccount, details: UserBankCredentialModel): {setOne: any, setTwo: any} => {
  const date = new Date().valueOf();

  const balanceHistory: BalanceHistoryModel = {
    balance: account.balance,
    date
  };

  const setOne = {
    'lastConnection': date,
    'details': {
      accountNumber: account.accountNumber,
      balance: account.balance
    },
    extraInfo: account.info,
    pastOrFutureDebits: account.pastOrFutureDebits
  };

  const setTwo = {
    'bankName': SupportedCompanies[details.companyId],
    'credentials': jwt.createNewToken(details),
  };

  return {
    setOne,
    setTwo
  }
}