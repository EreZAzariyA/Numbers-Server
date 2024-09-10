import moment from "moment";
import { CompanyTypes, ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers-by-e.a";
import bankLogic, { UserBankCredentialModel } from "../bll/banks";
import ClientError from "../models/client-error";
import { ErrorMessages } from "./helpers";
import { TransactionsAccount } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import jwt from "./jwt";
import { Banks, IUserBanksModal } from "../collections/Banks";
import { BankModel, IBankModal } from "../models/bank-model";

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

export const insertBankAccount = async (
  user_id: string,
  details: UserBankCredentialModel,
  account: TransactionsAccount
): Promise<IUserBanksModal> => {
  const banksAccount = await bankLogic.fetchBanksAccounts(user_id);
  const currBankAccount = banksAccount?.banks?.find((b) => b.bankName.toLowerCase() === details.companyId.toLowerCase());
  if (currBankAccount) {
    const query = createUpdateQuery(user_id, account, details);
    const options = {
      user_id: user_id,
      'banks.bankName': details.companyId
    };
    const projection = {
      new: true,
      upsert: true
    };

    try {
      const bankAccounts = await Banks.findOneAndUpdate(options, query, projection).exec();
      return bankAccounts;
    } catch (error: any) {
      console.log(error);
      return;
    }
  }

  try {
    const newBank = await createBank(details.companyId, details, account);
    const updatedBankAccount = await Banks.findOneAndUpdate(
      { user_id: user_id },
      { $push: { banks: newBank } },
      { new: true, upsert: true }
    ).exec();

    return updatedBankAccount;
  } catch (err: any) {
    console.log({err});
  }
};

export const createBank = async (
  bankName: string,
  credentialsDetails: UserBankCredentialModel,
  account: TransactionsAccount
): Promise<IBankModal> => {
  const bankAccount = new BankModel({
    bankName,
    credentials: jwt.createNewToken(credentialsDetails),
    details: {
      accountNumber: account.accountNumber,
      balance: account.balance
    },
    extraInfo: account.info,
    pastOrFutureDebits: account?.pastOrFutureDebits,
    creditCards: account.cardsPastOrFutureDebit?.cardsBlock,
    savings: account?.saving,
    lastConnection: new Date().valueOf()
  });
  return bankAccount;
}

export const createUpdateQuery = (
  user_id: string,
  account: TransactionsAccount,
  details: UserBankCredentialModel
): object => ({
  $set: {
    'banks.$.user_id': user_id,
    'banks.$.bankName': SupportedCompanies[details.companyId],
    'banks.$.lastConnection': new Date().valueOf(),
    'banks.$.details': {
      accountNumber: account?.accountNumber,
      balance: account?.balance
    },
    'banks.$.extraInfo': account?.info,
    'banks.$.pastOrFutureDebits': account?.pastOrFutureDebits,
    'banks.$.creditCards': account?.cardsPastOrFutureDebit?.cardsBlock,
    'banks.$.savings': account?.saving,
    ...(details.save && {
      'banks.$.credentials': jwt.createNewToken(details)
    })
  }
});