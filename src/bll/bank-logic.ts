import { IUserModel, UserModel } from "../models/user-model";
import jwt from "../utils/jwt";
import { CategoryModel, ICategoryModel } from "../models/category-model";
import categoriesLogic from "./categories-logic";
import { IInvoiceModel, InvoiceModel } from "../models/invoice-model";
import ClientError from "../models/client-error";
import { SupportedCompanies, createQuery, createUpdateQuery, getBankData } from "../utils/bank-utils";
import { ErrorMessages, isArrayAndNotEmpty } from "../utils/helpers";
import { PastOrFutureDebitType, Transaction, TransactionStatuses, TransactionsAccount } from "israeli-bank-scrapers-by-e.a/lib/transactions";

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

export interface UserBankCredentialModel {
  companyId: string;
  id: string;
  password: string;
  username?: string;
  num: string;
  save: boolean
};

class BankLogic {

  fetchBankData = async (details: UserBankCredentialModel, user_id: string): Promise<BankAccountDetails> => {
    const user = await UserModel.findById(user_id).exec();
    if (!user) {
      throw new ClientError(500, ErrorMessages.USER_NOT_FOUND);
    }

    if (!SupportedCompanies[details.companyId]) {
      throw new ClientError(500, `${ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
    }

    const scrapeResult = await getBankData(details);
    if (scrapeResult.success) {
      const account = scrapeResult.accounts[0];

      let query = {};
      const { setOne, setTwo } = createQuery(account, details);
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
              ...setTwo,
              pastOrFutureDebits: account.pastOrFutureDebits
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

        return {
          userBank: user?.bank,
          account,
          newUserToken: jwt.createNewToken(user.toObject())
        };
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }
    else {
      throw new ClientError(500, `Some scrapper error: ${scrapeResult.errorMessage || scrapeResult.errorType}`);
    }
  };

  updateBankAccountDetails = async (bankAccount_id: string, user_id: string): Promise<AccountDetails> => {
    const userAccount = await UserModel.findOne(
      { _id: user_id, bank: { $elemMatch: { _id: bankAccount_id } } },
      { 'bank': 1 }
    ).exec();
    if (!userAccount) {
      throw new ClientError(500, 'Some error while trying to find user with this account. Please contact us');
    }

    const userBankAccount = userAccount.bank[0];
    const credentials = userBankAccount?.credentials;
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
      save: decodedCredentials.save,
      username: decodedCredentials.username
    }

    let user: IUserModel = null;
    let insertedInvoices = [];
    let pastOrFutureDebits = [];

    const scrapeResult = await getBankData(details);
    if (scrapeResult.success) {
      const account = scrapeResult.accounts[0];
      if (account.txns && isArrayAndNotEmpty(account.txns)) {
        try {
          insertedInvoices = await this.importTransactions(account.txns, user_id, details.companyId);
        } catch (err: any) {
          throw new ClientError(500, err.message);
        }
      }
      if (account.pastOrFutureDebits && isArrayAndNotEmpty(account.pastOrFutureDebits)) {
        try {
          pastOrFutureDebits = await this.importPastOrFutureDebits(user_id, userBankAccount._id, account.pastOrFutureDebits);
        } catch (err: any) {
          throw new ClientError(500, err.message);
        }
      }

      const { setOne, setTwo } = createQuery(account, details);
      const query = {
        $set: {
          'bank.$': {
            ...setOne,
            ...setTwo,
            pastOrFutureDebits
          }
        }
      };

      try {
        user = await UserModel.findOneAndUpdate(
          { _id: user_id, bank: { $elemMatch: { _id: bankAccount_id } } },
          query,
          { new: true, upsert: true }
        ).select('-services').exec();

        if (!user) {
          throw new ClientError(500, "Some error on: 'UserModel.findOneAndUpdate' - trying to update null user");
        }

      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }

    return {
      newUserToken: jwt.getNewToken(user.toObject()),
      importedTransactions: insertedInvoices
    };
  };

  importTransactions = async (transactions: Transaction[], user_id: string, companyId: string) => {
    let defCategory: ICategoryModel = await CategoryModel.findOne({ user_id, name: 'Others' }).exec();
    if (!defCategory) {
      const category = new CategoryModel({ name: 'Others', user_id });
      defCategory = await categoriesLogic.addNewCategory(category, user_id);
    }

    const invoicesToInsert = [];
    for (const transaction of transactions) {
      const { identifier, status, date, originalAmount, chargedAmount } = transaction;

      const currentInvoice = await InvoiceModel.findOne({
        user_id,
        identifier,
      }).exec();

      if (currentInvoice && currentInvoice.status !== status) {
        try {
          currentInvoice.status = status;
          await currentInvoice.save();
        } catch (err: any) {
          throw new ClientError(500, `Some error while trying to update invoice ${currentInvoice.identifier}`);
        }
      }
  
      if (!currentInvoice) {
        const invoice = new InvoiceModel({
          user_id,
          companyId,
          date,
          identifier,
          description: transaction.description || 'no description provide',
          amount: originalAmount || chargedAmount,
          status: status || TransactionStatuses.Completed,
        });

        const isCategoryExist = await CategoryModel.exists({ name: transaction.categoryDescription});

        if (!transaction.categoryDescription) {
          invoice.category_id = defCategory._id;
        } else if (isCategoryExist) {
          invoice.category_id = isCategoryExist._id
        } else {
          const newCategory = new CategoryModel({ name: transaction?.categoryDescription || '' });
          const category = await categoriesLogic.addNewCategory(newCategory, user_id);
          invoice.category_id = category._id;
        }
  
        invoicesToInsert.push(invoice);
      }
    }

    const inserted = await InvoiceModel.insertMany(invoicesToInsert);
    return inserted;
  };

  importPastOrFutureDebits = async (user_id:string, bank_id: string, pastOrFutureDebits: PastOrFutureDebitType[]): Promise<PastOrFutureDebitType[]> => {
    const bankAccount = await UserModel.findOne(
      { _id: user_id, 'bank._id': bank_id.toString() },
      { 'bank.$': 1 }
    ).exec();
    const bankPastOrFutureDebits = bankAccount.bank[0].pastOrFutureDebits;

    pastOrFutureDebits.forEach((debit) => {
      if (bankPastOrFutureDebits.filter((d) => d.debitMonth === debit.debitMonth).length === 0) {
        bankAccount.bank[0].pastOrFutureDebits.push(debit);
      }
    });
    return bankPastOrFutureDebits;
  };
};

const bankLogic = new BankLogic();
export default bankLogic;