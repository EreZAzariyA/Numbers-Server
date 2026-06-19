import puppeteer from "puppeteer";
import { CompanyTypes, ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers-for-e.a-servers";
import { TransactionsAccount } from "israeli-bank-scrapers-for-e.a-servers/lib/transactions";
import { ClientError, BankModel, IBankModal } from "../models";
import { Accounts } from "../collections";
import { bankLogic } from "../bll";
import { encryptBankCredentials } from "./bank-credentials";
import { ErrorMessages, isCardProviderCompany, isSupportedCompany, SupportedCompanies, UserBankCredentials } from "./helpers";
import config from "./config";

const requireString = (value: string | undefined, fieldName: string): string => {
  if (value) {
    return value;
  }

  throw new ClientError(400, `${fieldName} is missing`);
};

const createCredentials = (details: UserBankCredentials): ScraperCredentials => {
  if (!isSupportedCompany(details.companyId)) {
    throw new ClientError(500, `${ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
  }

  let credentials: ScraperCredentials | undefined;
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
        username: requireString(details.username, 'Username'),
        password: details.password
      };
    break;
    case SupportedCompanies[CompanyTypes.visaCal]:
      credentials = {
        username: requireString(details.username, 'Username'),
        password: details.password
      };
    break;
    case SupportedCompanies[CompanyTypes.behatsdaa]:
      credentials = {
        id: details.id,
        password: details.password
      };
    break;
    case SupportedCompanies[CompanyTypes.leumi]:
      credentials = {
        username: requireString(details.username, 'Username'),
        password: details.password
      };
    break;
  }

  if (!credentials) {
    throw new ClientError(500, `${ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
  }

  return credentials;
};

export const getBankData = async (details: UserBankCredentials): Promise<ScraperScrapingResult> => {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - config.bankScraper.lookbackMonths);
  if (!isSupportedCompany(details.companyId)) {
    throw new ClientError(500, `${ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
  }

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: config.bankScraper.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  // The scraper bundles its own copy of puppeteer, whose Browser type is nominally
  // distinct from ours (puppeteer's #private brand) even at the same version. The
  // runtime object is correct, so cast across the install boundary via unknown.
  const options = {
    companyId: CompanyTypes[details.companyId],
    startDate,
    combineInstallments: false,
    defaultTimeout: config.bankScraper.defaultTimeoutMs,
    includeRawTransaction: true,
    additionalTransactionInformation: true,
    browser,
  } as unknown as ScraperOptions;

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
    throw new ClientError(500, 'Failed to insert bank account');
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
    if (!bankAccounts) {
      throw new ClientError(500, ErrorMessages.BANK_ACCOUNT_NOT_FOUND);
    }

    const updatedBank = bankAccounts.banks.find((b) => b._id?.toString() === currBankAccount._id?.toString());
    if (!updatedBank) {
      throw new ClientError(500, ErrorMessages.BANK_ACCOUNT_NOT_FOUND);
    }

    return updatedBank;
  } catch (error: any) {
    console.log(error);
    throw new ClientError(500, 'Failed to update bank account');
  }
};

const createBank = async (
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
    securities: account?.securities,
    ...(credentialsDetails?.save && {
      credentials: encryptBankCredentials(credentialsDetails),
    }),
  });

  return bankAccount;
};

const createUpdateQuery = (
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
    'banks.$.securities': account?.securities,
    ...(details.save && {
      'banks.$.credentials': encryptBankCredentials(details)
    })
  }
});
