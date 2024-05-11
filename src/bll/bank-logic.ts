import { CompanyTypes, ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers";
import moment from "moment";
import { UserModel } from "../models/user-model";
import jwt from "../utils/jwt";
import { Transaction, TransactionStatuses, TransactionsAccount } from "israeli-bank-scrapers/lib/transactions";
import { CategoryModel, ICategoryModel } from "../models/category-model";
import categoriesLogic from "./categories-logic";
import { InvoiceModel } from "../models/invoice-model";
import ClientError from "../models/client-error";
import { SupportedCompanies } from "../utils/helpers";

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
};

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
      throw new ClientError(500, 'user not found');
    }

    if (!SupportedCompanies[details.companyId]) {
      throw new ClientError(500, `Company ${details.companyId} is not supported`);
    }

    const scrapeResult = await getBankData(details);
    if (scrapeResult.success) {
      const account = scrapeResult.accounts[0];

      let query: any;
      const setOne = {
        'lastConnection': new Date().valueOf(),
        'details': {
          accountNumber: account.accountNumber,
          balance: account.balance
        },
      };
      const setTwo = {
        'bankName': SupportedCompanies[details.companyId],
        'credentials': jwt.createNewToken(details),
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
      if (details.save === false) {
        query = { $unset: { ...setTwo } };
      }

      try {
        const user = await UserModel.findByIdAndUpdate(user_id, query, { new: true }).select('-services').exec();
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
      throw new Error(scrapeResult.errorType);
    }
  };

  importTransactions = async (invoices: Transaction[], user_id: string) => {
    let defCategory: ICategoryModel = await CategoryModel.findOne({ user_id, name: 'Others' }).exec();
    if (!defCategory) {
      const category = new CategoryModel({name: 'Others', user_id});
      defCategory = await categoriesLogic.addNewCategory(category);
    }

    const invoicesToInsert = [];
    for (const trans of invoices) {
      const isExist = await InvoiceModel.findOne({ user_id, description: trans.description }).exec();
      if (!isExist) {
        let invoice = new InvoiceModel({
          date: trans.date,
          description: trans.description || '',
          amount: trans.originalAmount || trans.chargedAmount,
          status: trans.status || TransactionStatuses.Completed,
          user_id: user_id,
        });

        if (!trans.category) {
          invoice.category_id = defCategory._id;
        } else {
          invoice.category_id = trans.category;
        }
  
        invoicesToInsert.push(invoice);
      }
    }

    const inserted = await InvoiceModel.insertMany(invoicesToInsert);
    return inserted;
  };

  updateBankAccountDetails = async (bankAccount_id: string, user_id: string): Promise<BankAccountDetails> => {
    const userAccount = await UserModel.findOne({_id: user_id, 'bank.$._id': bankAccount_id }, { 'bank': 1 }).exec();
    if (!userAccount) {
      throw new ClientError(500, 'Some error while trying to find user with this account. Please contact us');
    }

    const userBankAccount = userAccount.bank[0];
    const credentials = userBankAccount.credentials;
    if (!credentials) {
      throw new ClientError(500, 'Some error while trying to load saved credentials. Please contact us');
    }

    const decodedCredentials = await jwt.fetchBankCredentialsFromToken(credentials);
    if (!decodedCredentials) {
      throw new ClientError(500, 'Some error while trying to load decoded credentials. Please contact us');
    }

    const details = {
      companyId: userBankAccount.bankName,
      id: decodedCredentials.id,
      password: decodedCredentials.password,
      num: decodedCredentials.num,
      save: decodedCredentials.save
    }

    const scrapeResult = await getBankData(details);
    if (scrapeResult.success) {
      const account = scrapeResult.accounts[0];

      let query = { 
        $set: {
          bank: {
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
        const user = await UserModel.findOneAndUpdate(
          { _id: user_id, 'bank.$._id': bankAccount_id },
          query,
          { new: true }
        ).select('-services').exec();

        return {
          userBank: user?.bank,
          account,
          newUserToken: jwt.getNewToken(user.toObject())
        };
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }
  };
};

const bankLogic = new BankLogic();
export default bankLogic;