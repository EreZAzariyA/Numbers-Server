import moment from "moment";
import { CompanyTypes, ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers-for-e.a-servers";
import { TransactionsAccount } from "israeli-bank-scrapers-for-e.a-servers/lib/transactions";
import { ClientError, BankModel, IBankModal } from "../models";
import { Accounts } from "../collections";
import { bankLogic } from "../bll";
import jwtService from "./jwt";
import { ErrorMessages, isCardProviderCompany, SupportedCompanies, UserBankCredentials } from "./helpers";

export const createCredentials = (details: UserBankCredentials): ScraperCredentials => {
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

export const getBankData = async (details: UserBankCredentials): Promise<ScraperScrapingResult> => {
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
  details: UserBankCredentials,
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
  details: UserBankCredentials
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
  credentialsDetails: UserBankCredentials,
  account: TransactionsAccount
): Promise<IBankModal> => {
  const isCardProvider = isCardProviderCompany(credentialsDetails.companyId);

  const bankAccount = new BankModel({
    bankName,
    isCardProvider,
    lastConnection: new Date().valueOf(),
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
      credentials: jwtService.createNewToken(credentialsDetails),
    }),
  });

  return bankAccount;
};

export const createUpdateQuery = (
  account: TransactionsAccount,
  details: UserBankCredentials
): object => ({
  $set: {
    'banks.$.lastConnection': new Date().valueOf(),
    'banks.$.details': {
      balance: account?.balance,
    },
    'banks.$.extraInfo': account?.info,
    'banks.$.pastOrFutureDebits': account?.pastOrFutureDebits,
    'banks.$.cardsPastOrFutureDebit': account?.cardsPastOrFutureDebit,
    'banks.$.savings': account?.saving,
    'banks.$.loans': account?.loans,
    ...(details.save && {
      'banks.$.credentials': jwtService.createNewToken(details)
    })
  }
});