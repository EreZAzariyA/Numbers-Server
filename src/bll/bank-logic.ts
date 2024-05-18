import { CompanyTypes, ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers";
import moment from "moment";
import { BalanceHistoryModel, IUserModel, UserModel } from "../models/user-model";
import jwt from "../utils/jwt";
import { Transaction, TransactionStatuses, TransactionsAccount } from "israeli-bank-scrapers/lib/transactions";
import { CategoryModel, ICategoryModel } from "../models/category-model";
import categoriesLogic from "./categories-logic";
import { IInvoiceModel, InvoiceModel } from "../models/invoice-model";
import ClientError from "../models/client-error";
import { SupportedCompanies } from "../utils/bank-utils";

class UserBankModel {
  bankName: string;
  credentials: string;
  details: object;
  lastConnection: number;
};

interface BankAccountDetails {
  userBank: UserBankModel[];
  account: TransactionsAccount;
  newUserToken: string;
  importedTransactions?: IInvoiceModel[]
};

export type AccountDetails = Pick<BankAccountDetails, "newUserToken" | "importedTransactions">;

interface UserBankCredentialModel {
  companyId: string;
  id: string;
  password: string;
  num: string;
  save: boolean
};

const getBankData = async (details: UserBankCredentialModel): Promise<ScraperScrapingResult> => {
  const lastYear = moment().subtract('1', 'years').calendar();

  const options: ScraperOptions = {
    companyId: CompanyTypes[details.companyId],
    startDate: new Date(lastYear),
    combineInstallments: false,
    showBrowser: false,
  };

  const credentials: ScraperCredentials = {
    id: details.id,
    password: details.password,
    num: details.num
  };

  const scraper = createScraper(options);
  const scrapeResult = await scraper.scrape(credentials);
  return scrapeResult;
};

class BankLogic {

  fetchBankData = async (details: UserBankCredentialModel, user_id: string): Promise<BankAccountDetails> => {
    const user = await UserModel.findById(user_id).exec();
    if (!user) {
      console.error('user not found');
      throw new ClientError(500, 'user not found');
    }

    if (!SupportedCompanies[details.companyId]) {
      console.error(`Company ${details.companyId} is not supported`);
      throw new ClientError(500, `Company ${details.companyId} is not supported`);
    }

    const scrapeResult = await getBankData(details);
    if (scrapeResult.success) {
      const account = scrapeResult.accounts[0];

      const balanceHistory: BalanceHistoryModel = {
        balance: account.balance,
        date: new Date().valueOf()
      };

      let query: any;
      const setOne = {
        'lastConnection': new Date().valueOf(),
        'details': {
          accountNumber: account.accountNumber,
          balance: account.balance
        },
        balanceHistory
      };
      const setTwo = {
        'bankName': SupportedCompanies[details.companyId],
        'credentials': jwt.createNewToken(details),
      };

      query = {
        $push: {
          bank: {
            ...setOne,
          }
        }
      };

      if (details.save) {
        query = {
          $push: {
            bank: {
              ...setOne,
              ...setTwo
            }
          }
        };
      }

      if (!details.save) {
        query = { $unset: { ...setTwo } };
      }

      try {
        const user = await UserModel.findByIdAndUpdate(
          user_id,
          query,
          { new: true }
        ).select('-services').exec();
        const userBank = user?.bank;
        return {
          userBank,
          account,
          newUserToken: jwt.createNewToken(user.toObject())
        };
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }
    else {
      console.error('Some scrapper error:', scrapeResult.errorMessage);
      throw new Error(scrapeResult.errorType);
    }
  };

  updateBankAccountDetails = async (bankAccount_id: string, user_id: string): Promise<AccountDetails> => {
    const userAccount = await UserModel.findOne({ _id: user_id, bank: { $elemMatch: { _id: bankAccount_id } } }, { 'bank': 1 }).exec();
    if (!userAccount) {
      console.error('userAccount not found');
      throw new ClientError(500, 'Some error while trying to find user with this account. Please contact us');
    }

    const userBankAccount = userAccount.bank[0];
    const credentials = userBankAccount.credentials;
    if (!credentials) {
      console.error('credentials not found');
      throw new ClientError(500, 'Some error while trying to load saved credentials. Please contact us');
    }

    const decodedCredentials = await jwt.fetchBankCredentialsFromToken(credentials);
    if (!decodedCredentials) {
      console.error('decodedCredentials not found');
      throw new ClientError(500, 'Some error while trying to load decoded credentials. Please contact us');
    }

    const details = {
      companyId: userBankAccount.bankName,
      id: decodedCredentials.id,
      password: decodedCredentials.password,
      num: decodedCredentials.num,
      save: decodedCredentials.save
    }

    let user: IUserModel = null;
    let insertedInvoices = [];
    const scrapeResult = await getBankData(details);
    if (scrapeResult.success) {
      const account = scrapeResult.accounts[0];
      if (account.txns && account.txns.length) {
        try {
          insertedInvoices = await this.importTransactions(account.txns, user_id);
        } catch (err: any) {
          console.log(err);
          throw new ClientError(500, err.message);
        }
      }

      const balanceHistory: BalanceHistoryModel = {
        balance: account.balance,
        date: new Date().valueOf()
      };

      let query = {
        $set: {
          'bank.$': {
            'lastConnection': new Date().valueOf(),
            'details': {
              accountNumber: account.accountNumber,
              balance: account.balance
            },
            'bankName': SupportedCompanies[details.companyId],
            'credentials': jwt.createNewToken(details),
          }
        }
      };

      try {
        user = await UserModel.findOneAndUpdate(
          { _id: user_id, bank: { $elemMatch: { _id: bankAccount_id } } },
          query,
          { new: true }
        ).select('-services').exec();
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }

    return {
      newUserToken: jwt.getNewToken(user.toObject()),
      importedTransactions: insertedInvoices
    };
  };

  importTransactions = async (invoices: Transaction[], user_id: string) => {
    let defCategory: ICategoryModel = await CategoryModel.findOne({ user_id, name: 'Others' }).exec();
    if (!defCategory) {
      const category = new CategoryModel({ name: 'Others', user_id });
      defCategory = await categoriesLogic.addNewCategory(category, user_id);
    }

    const invoicesToInsert = [];
    for (const trans of invoices) {
      const isExist = await InvoiceModel.findOne({
        user_id,
        identifier: trans.identifier,
      }).exec();
      if (isExist && isExist.status !== trans.status) {
        try {
          isExist.status = trans.status;
          await isExist.save();
        } catch (err: any) {
          throw new ClientError(500, `Some error while trying to update invoice ${isExist.identifier}`);
        }
      }
  
      if (!isExist) {
        let invoice = new InvoiceModel({
          user_id,
          date: trans.date,
          identifier: trans.identifier,
          description: trans.description || 'no description provide',
          amount: trans.originalAmount || trans.chargedAmount,
          status: trans.status || TransactionStatuses.Completed,
        });

        const isCategoryExist = await CategoryModel.exists({ name: trans.CategoryDescription});

        if (!trans.CategoryDescription) {
          invoice.category_id = defCategory._id;
        } else if (isCategoryExist) {
          invoice.category_id = isCategoryExist._id
        } else {
          const newCategory = new CategoryModel({ name: trans?.CategoryDescription || 'test' });
          const category = await categoriesLogic.addNewCategory(newCategory, user_id);
          invoice.category_id = category._id;
        }
  
        invoicesToInsert.push(invoice);
      }
    }

    const inserted = await InvoiceModel.insertMany(invoicesToInsert);
    return inserted;
  };
};

const bankLogic = new BankLogic();
export default bankLogic;