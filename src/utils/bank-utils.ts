import moment from "moment";
import { CompanyTypes, ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers-by-e.a";
import bankLogic, { UserBankCredentialModel } from "../bll/banks";
import ClientError from "../models/client-error";
import { ErrorMessages } from "./helpers";
import { TransactionsAccount } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import jwt from "./jwt";
import { UserBanks, IBanksModal, IBankModal, BankModel } from "../models/bank-model";

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

export const insertBankAccount = async (user_id: string, details: UserBankCredentialModel, account: TransactionsAccount): Promise<IBanksModal> => {
  const banksAccount = await bankLogic.fetchOneBankAccount(user_id, details.companyId);
  if (!!banksAccount) {
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
      const bankAccounts = await UserBanks.findOneAndUpdate(options, query, projection).exec();
      return bankAccounts;
    } catch (error: any) {
      console.log(error);
      return;
    }
  }

  const newBank = await createBank(details.companyId, details, account);

  const newBankAccount = new UserBanks({
    user_id,
    banks: [newBank]
  });

  const errors = newBankAccount.validateSync();
  if (errors) {
    console.log({errors});
    throw new ClientError(500, errors.message);
  }

  return newBankAccount.save();
};

export const createBank = async (bankName: string, credentialsDetails: UserBankCredentialModel, account: TransactionsAccount) => {
  const bankAccount = new BankModel({
    bankName,
    credentials: jwt.createNewToken(credentialsDetails),
    details: {
      accountNumber: account.accountNumber,
      balance: account.balance
    },
    extraInfo: account.info,
    pastOrFutureDebits: account.pastOrFutureDebits,
    creditCards: account.cardsPastOrFutureDebit.cardsBlock,
    savings: account.saving
  });

  return bankAccount;
}

export const createUpdateQuery = (user_id: string, account: TransactionsAccount, details: UserBankCredentialModel): object => {
  return {
    $set: {
      'banks.$.user_id': user_id,
      'banks.$.bankName': SupportedCompanies[details.companyId],
      'banks.$.lastConnection': new Date().valueOf(),
      'banks.$.details': {
        accountNumber: account.accountNumber,
        balance: account.balance
      },
      'banks.$.extraInfo': account.info,
      'banks.$.pastOrFutureDebits': account.pastOrFutureDebits,
      'banks.$.creditCards': account.cardsPastOrFutureDebit.cardsBlock,
      'banks.$.savings': account.saving,
      ...(details.save && {
        'banks.$.credentials': jwt.createNewToken(details)
      })
    }
  };
};