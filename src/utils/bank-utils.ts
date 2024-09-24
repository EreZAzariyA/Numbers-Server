import moment from "moment";
import { CompanyTypes, ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers-by-e.a";
import bankLogic, { UserBankCredentialModel } from "../bll/banks";
import ClientError from "../models/client-error";
import { ErrorMessages } from "./helpers";
import { TransactionsAccount } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import jwt from "./jwt";
import { Banks } from "../collections/Banks";
import { AccountModel, IAccountModal } from "../models/bank-model";

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

export const isCardProviderCompany = (company: string) => {
  return CreditCardProviders.includes(CompanyTypes[company]) || false;
};

export const createCredentials = (details: UserBankCredentialModel): ScraperCredentials => {
  if (!SupportedCompanies[details.companyId]) {
    throw new ClientError(500, `${ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
  }

  let credentials: ScraperCredentials = null;
  switch (details.companyId) {
    case SupportedCompanies[CompanyTypes.discount]:
      credentials = {
        id: details.id,
        password: details.password,
        num: details.num
      };
    break;
    case SupportedCompanies[CompanyTypes.max]:
      credentials = {
        username: details.username,
        password: details.password
      };
    break;
    case SupportedCompanies[CompanyTypes.visaCal]:
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
): Promise<IAccountModal> => {
  const banksAccount = await bankLogic.fetchBanksAccounts(user_id);
  const currBankAccount = banksAccount?.banks?.find((b) => {
    return b.bankName.toLowerCase() === details.companyId.toLowerCase();
  });

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
      return bankAccounts.banks.find((b) => b._id === currBankAccount._id);
    } catch (error: any) {
      console.log(error);
      return;
    }
  }

  try {
    const newBank = await createBank(details.companyId, details, account);
    await Banks.findOneAndUpdate(
      { user_id: user_id },
      { $push: { banks: newBank } },
      { new: true, upsert: true }
    ).exec();

    return newBank;
  } catch (err: any) {
    console.log({ err });
  }
};

export const createBank = async (
  bankName: string,
  credentialsDetails: UserBankCredentialModel,
  account: TransactionsAccount
): Promise<IAccountModal> => {
  const isCardProvider = isCardProviderCompany(credentialsDetails.companyId);

  const bankAccount = new AccountModel({
    bankName,
    isCardProvider,
    lastConnection: new Date().valueOf(),
    ...(credentialsDetails?.save && {
      credentials: jwt.createNewToken(credentialsDetails),
    }),
    ...(isCardProvider ? {
      creditCards: account.creditCards
    } : {
      details: {
        accountNumber: account.accountNumber,
        balance: account.balance,
      },
      creditCards: account.cardsPastOrFutureDebit?.cardsBlock,
      extraInfo: account.info,
      pastOrFutureDebits: account?.pastOrFutureDebits,
      savings: account?.saving,
    })
  });
  console.log({ bankAccount });

  return bankAccount;
};

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