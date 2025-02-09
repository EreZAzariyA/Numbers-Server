import moment from "moment";
import { CompanyTypes, ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers-by-e.a";
import bankLogic, { UserBankCredentialModel } from "../bll/banks";
import ClientError from "../models/client-error";
import { ErrorMessages } from "./helpers";
import { TransactionsAccount } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import jwt from "./jwt";
import { BankModel, IBankModal } from "../models/bank-model";
import { Accounts } from "../collections/Banks";

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
): Promise<IBankModal> => {
  const banksAccount = await bankLogic.fetchMainAccount(user_id);
  const currBankAccount = banksAccount?.banks?.find((b) => {
    return b.bankName.toLowerCase() === details.companyId.toLowerCase();
  });

  if (currBankAccount) {
    return await updateBank(currBankAccount, user_id, account, details);
  }

  try {
    const newBank = await createBank(details.companyId, details, account);
    await Accounts.findOneAndUpdate(
      { user_id: user_id },
      { $push: { banks: newBank } },
      { new: true, upsert: true }
    ).exec();

    return newBank;
  } catch (err: any) {
    console.log({ err });
  }
};

const updateBank = async (
  currBankAccount: IBankModal,
  user_id: string,
  account: TransactionsAccount,
  details: UserBankCredentialModel
): Promise<IBankModal> => {
  const query = createUpdateQuery(account, details);
  const options = {
    user_id: user_id,
    'banks._id': currBankAccount._id
  };
  const projection = {
    new: true,
    upsert: true
  };

  try {
    const bankAccounts = await Accounts.findOneAndUpdate(options, query, projection).exec();
    return bankAccounts.banks.find((b) => b._id?.toString() === currBankAccount._id?.toString());
  } catch (error: any) {
    console.log(error);
    return;
  }
};

export const createBank = async (
  bankName: string,
  credentialsDetails: UserBankCredentialModel,
  account: TransactionsAccount
): Promise<IBankModal> => {
  const isCardProvider = isCardProviderCompany(credentialsDetails.companyId);

  const bankAccount = new BankModel({
    bankName,
    isCardProvider,
    lastConnection: {
      date: new Date().toISOString(),
      message: 'success',
      success: true
    },
    details: {
      accountNumber: account.accountNumber,
      balance: account.balance,
    },
    cardsPastOrFutureDebit: account.cardsPastOrFutureDebit,
    extraInfo: account.info,
    pastOrFutureDebits: account?.pastOrFutureDebits,
    savings: account?.saving,
    loans: account?.loans,
    ...(credentialsDetails?.save && {
      credentials: jwt.createNewToken(credentialsDetails),
    }),
  });

  return bankAccount;
};

export const createUpdateQuery = (account: TransactionsAccount, details: UserBankCredentialModel): object => ({
  $set: {
    'banks.$.lastConnection': {
      'date': new Date().toISOString(),
      'message': 'success',
      'success': true
    },
    'banks.$.details': {
      balance: account?.balance,
    },
    'banks.$.extraInfo': account?.info,
    'banks.$.pastOrFutureDebits': account?.pastOrFutureDebits,
    'banks.$.cardsPastOrFutureDebit': account?.cardsPastOrFutureDebit,
    'banks.$.savings': account?.saving,
    'banks.$.loans': account?.loans,
    ...(details.save && {
      'banks.$.credentials': jwt.createNewToken(details)
    })
  }
});

export const createBankErrorStatus = async (user_id: string, bankName: string, message: string, bank_id?: string) => {
  console.info('Creating bank error...');

  const userAccount = await Accounts.findOne({ user_id }).exec();
  if (!userAccount) {
    return;
  }

  const banks = userAccount.banks || [];
  const currentBank = banks.find((b) => b.bankName.toLocaleLowerCase() === bankName.toLocaleLowerCase());
  if (currentBank) {
    return Accounts.findOneAndUpdate(
      { user_id, 'banks._id': currentBank._id },
      {
        $set: { 'banks.$.lastConnection': {
          date: new Date().toISOString(),
          message,
          success: false
        }},
      },
      { new: true }
    ).exec();
  } else {
    const bankWithError = new BankModel({
      bankName,
      lastConnection: {
        date: new Date().toISOString(),
        message,
        success: false
      }
    });
    userAccount.banks.push(bankWithError);
    return userAccount.save({ validateBeforeSave: true });
  }
};