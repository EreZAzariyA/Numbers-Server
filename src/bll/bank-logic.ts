import { UserModel } from "../models/user-model";
import { CategoryModel, ICategoryModel } from "../models/category-model";
import categoriesLogic from "./categories-logic";
import { IInvoiceModel, InvoiceModel } from "../models/invoice-model";
import ClientError from "../models/client-error";
import { SupportedCompanies, getBankData, insertBankAccount } from "../utils/bank-utils";
import { ErrorMessages, isArrayAndNotEmpty } from "../utils/helpers";
import { PastOrFutureDebitType, Transaction, TransactionsAccount, TransactionStatuses } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import { UserBanks, IBanksModal, IBankModal } from "../models/bank-model";
import jwt from "../utils/jwt";

interface BankAccountDetails {
  bank: IBanksModal;
  account: TransactionsAccount;
  importedTransactions?: IInvoiceModel[]
};

export interface UserBankCredentialModel {
  companyId: string;
  id: string;
  password: string;
  username?: string;
  num: string;
  save: boolean;
};

class BankLogic {
  fetchBanksAccounts = async (userId: string): Promise<IBankModal[]> => {
    const account = await UserBanks.findOne({ userId: userId }).exec();
    return account.banks;
  };

  fetchOneBankAccount = async (userId: string, bankName: string): Promise<IBankModal> => {
    const banks = await this.fetchBanksAccounts(userId);
    const bankAccount = banks.find((bank) => bank.bankName === bankName);
    return bankAccount;
  };

  fetchBankData = async (details: UserBankCredentialModel, user_id: string): Promise<BankAccountDetails> => {
    const user = await UserModel.findById(user_id).exec();
    if (!user) {
      throw new ClientError(500, ErrorMessages.USER_NOT_FOUND);
    }

    if (!SupportedCompanies[details.companyId]) {
      throw new ClientError(500, `${ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
    }

    const scrapeResult = await getBankData(details);
    if (scrapeResult.errorType || scrapeResult.errorMessage) {
      console.error(`Scraper error on 'BankLogic/fetchBankData': ${scrapeResult.errorMessage}.`);
      throw new ClientError(500, ErrorMessages.INCORRECT_LOGIN_ATTEMPT);
    }

    try {
      const account = scrapeResult.accounts[0];
      const bank = await insertBankAccount(user_id, details, account);

      return {
        bank,
        account,
      };
    } catch (err: any) {
      console.log(err);
      throw new ClientError(500, 'Error');
    }
  };

  refreshBankData = async (bankName: string, user_id: string, newDetailsCredentials?: string): Promise<BankAccountDetails> => {
    const bankAccount = await bankLogic.fetchOneBankAccount(user_id, bankName);
    if (!bankAccount) {
      throw new ClientError(500, 'Some error while trying to find user with this account. Please contact us');
    }

    let credentials: string;
    if (newDetailsCredentials) {
      credentials = newDetailsCredentials
    } else {
      credentials = bankAccount?.credentials;
    }
    if (!credentials) {
      throw new ClientError(500, 'Some error while trying to load saved credentials. Please contact us');
    }

    const decodedCredentials = await jwt.fetchBankCredentialsFromToken(credentials);
    if (!decodedCredentials) {
      throw new ClientError(500, 'Some error while trying to load decoded credentials. Please contact us');
    }

    const details = {
      companyId: decodedCredentials.companyId,
      id: decodedCredentials.id,
      password: decodedCredentials.password,
      num: decodedCredentials.num,
      save: decodedCredentials.save,
      username: decodedCredentials.username
    };

    const scrapeResult = await getBankData(details);
    if (scrapeResult.errorType || scrapeResult.errorMessage) {
      throw new ClientError(500, scrapeResult.errorMessage);
    }

    const account = scrapeResult.accounts[0];

    let insertedInvoices = [];
    let pastOrFutureDebits = [];

    if (account.txns && isArrayAndNotEmpty(account.txns)) {
      try {
        insertedInvoices = await this.importTransactions(account.txns, user_id, details.companyId);
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }
    if (account.pastOrFutureDebits && isArrayAndNotEmpty(account.pastOrFutureDebits)) {
      try {
        pastOrFutureDebits = await this.importPastOrFutureDebits(user_id, bankName, account.pastOrFutureDebits);
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }

    try {
      const bank = await insertBankAccount(user_id, details, account);

      return {
        account,
        bank,
        importedTransactions: insertedInvoices,
      };
    } catch (err: any) {
      throw new ClientError(500, err.message);
    }
  };

  updateBankAccountDetails = async (bankName: string, user_id: string, newDetails: UserBankCredentialModel) => {
    const bankAccount = await bankLogic.fetchOneBankAccount(user_id, bankName);
    if (!bankAccount) {
      throw new ClientError(500, ErrorMessages.USER_BANK_ACCOUNT_NOT_FOUND);
    }

    const credentials = bankAccount?.credentials;
    if (!credentials) {
      throw new ClientError(500, ErrorMessages.CREDENTIALS_SAVED_NOT_LOADED);
    }

    const decodedCredentials = await jwt.fetchBankCredentialsFromToken(credentials);
    if (!decodedCredentials) {
      throw new ClientError(500, ErrorMessages.DECODED_CREDENTIALS_NOT_LOADED);
    }

    const oldCredentials = [];
    oldCredentials.push(decodedCredentials);

    const newDetailsCredentials = jwt.createNewToken(newDetails);

    const res = await this.refreshBankData(bankName, user_id, newDetailsCredentials);
    return res;
  };

  importTransactions = async (transactions: Transaction[], user_id: string, companyId: string) => {
    let defCategory: ICategoryModel = await CategoryModel.findOne({ user_id, name: 'Others' }).exec();
    if (!defCategory) {
      const category = new CategoryModel({ name: 'Others', user_id });
      defCategory = await categoriesLogic.addNewCategory(category, user_id);
    }

    const transactionsToInsert = [];
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
  
        transactionsToInsert.push(invoice);
      }
    }

    const inserted = await InvoiceModel.insertMany(transactionsToInsert);
    return inserted;
  };

  importPastOrFutureDebits = async (user_id: string, bankName: string, pastOrFutureDebits: PastOrFutureDebitType[]): Promise<PastOrFutureDebitType[]> => {
    const bankAccount = await this.fetchOneBankAccount(user_id, bankName);

    const bankPastOrFutureDebits = bankAccount?.pastOrFutureDebits || [];
    pastOrFutureDebits.forEach((debit) => {
      if (bankPastOrFutureDebits.filter((d) => d.debitMonth === debit.debitMonth).length === 0) {
        bankAccount[0].pastOrFutureDebits.push(debit);
      }
    });
    return bankPastOrFutureDebits;
  };
};

const bankLogic = new BankLogic();
export default bankLogic;