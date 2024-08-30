import { UserModel } from "../models/user-model";
import ClientError from "../models/client-error";
import { SupportedCompanies, getBankData, insertBankAccount } from "../utils/bank-utils";
import { ErrorMessages, isArrayAndNotEmpty } from "../utils/helpers";
import { PastOrFutureDebitType, Transaction, TransactionsAccount } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import jwt from "../utils/jwt";
import categoriesLogic from "./categories";
import { ITransactionModel, Transactions } from "../collections/Transactions";
import transactionsLogic from "./transactions";
import mongoose from "mongoose";
import { IUserBanksModal, Banks } from "../collections/Banks";
import { IBankModal } from "../models/bank-model";

interface BankAccountDetails {
  bank: IUserBanksModal;
  account: TransactionsAccount;
};
interface RefreshedBankAccountDetails {
  bank: IBankModal;
  account: TransactionsAccount;
  importedTransactions?: ITransactionModel[];
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
  fetchBanksAccounts = async (user_id: string, query = {}): Promise<IUserBanksModal> => {
    const account = await Banks.findOne({ user_id, ...query }).exec();
    return account;
  };

  fetchOneBankAccount = async (user_id: string, bank_id: string): Promise<IBankModal> => {
    const banksAccount = await this.fetchBanksAccounts(user_id);
    if (!!banksAccount) {
      const bank = banksAccount.banks.find((bank) => bank._id?.toString() === bank_id);
      return bank;
    }
    return null;
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

  refreshBankData = async (bank_id: string, user_id: string, newDetailsCredentials?: string): Promise<RefreshedBankAccountDetails> => {
    const bankAccount = await bankLogic.fetchOneBankAccount(user_id, bank_id);
    if (!bankAccount) {
      throw new ClientError(500, 'Some error while trying to find user with this account. Please contact us');
    }

    const credentials = !!newDetailsCredentials ? newDetailsCredentials : bankAccount?.credentials;
    if (!credentials) {
      throw new ClientError(500, 'Some error while trying to load saved credentials. Please contact us');
    }

    const decodedCredentials = await jwt.fetchBankCredentialsFromToken(credentials);
    if (!decodedCredentials) {
      throw new ClientError(500, 'Some error while trying to load decoded credentials. Please contact us');
    }

    const details: UserBankCredentialModel = {
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
        pastOrFutureDebits = await this.importPastOrFutureDebits(user_id, bank_id, account.pastOrFutureDebits);
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }

    try {

      await insertBankAccount(user_id, details, account);
      const bank = await bankLogic.fetchOneBankAccount(user_id, bank_id);

      return {
        bank,
        account,
        importedTransactions: insertedInvoices,
      };
    } catch (err: any) {
      throw new ClientError(500, err.message);
    }
  };

  updateBankAccountDetails = async (bank_id: string, user_id: string, newDetails: UserBankCredentialModel) => {
    const bankAccount = await bankLogic.fetchOneBankAccount(user_id, bank_id);
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

    const res = await this.refreshBankData(bank_id, user_id, newDetailsCredentials);
    return res;
  };

  importTransactions = async (transactions: Transaction[], user_id: string, companyId: string) => {
    let defCategory = await categoriesLogic.fetchUserCategory(user_id, 'Others');
    if (!defCategory) {
      try {
        defCategory = await categoriesLogic.addNewCategory('Others', user_id);
      } catch (err) {
        throw new Error('[bankLogic/importTransactions]: Some error while trying to add default category');
      }
    }

    const transactionsToInsert: ITransactionModel[] = [];
    for (const originalTransaction of transactions) {
      const { identifier, status, date, originalAmount, chargedAmount, description, categoryDescription } = originalTransaction;

      const existedTransaction = await transactionsLogic.fetchUserBankTransaction(user_id, originalTransaction);
      if (!!existedTransaction) {
        if (existedTransaction.status !== originalTransaction.status) {
          try {
            await transactionsLogic.updateTransactionStatus(existedTransaction, status);
          } catch (err: any) {
            console.log(`Some error while trying to update transaction ${existedTransaction.identifier}`);
            throw new ClientError(500, `Some error while trying to update transaction ${existedTransaction.identifier}`);
          }
        }
        continue;
      }

      let originalTransactionCategory = await categoriesLogic.fetchUserCategory(user_id, categoryDescription);
      if (!originalTransactionCategory?._id) {
        if (categoryDescription) {
          originalTransactionCategory = await categoriesLogic.addNewCategory(categoryDescription, user_id);
        } else {
          originalTransactionCategory = defCategory;
        }
      }

      const transaction = new Transactions({
        user_id,
        date,
        identifier: identifier || new mongoose.Types.ObjectId().toString(),
        description,
        companyId,
        status,
        amount: originalAmount || chargedAmount,
        category_id: originalTransactionCategory._id
      });
      transactionsToInsert.push(transaction);
    }

    try {
      const inserted = await Transactions.insertMany(transactionsToInsert);
      console.log({inserted});
      
      return inserted || [];
    } catch (err: any) {
      console.log({ ['bankLogic/importTransactions']: err?.message });
      throw new ClientError(500, 'An error occurred while importing transactions');
    }
  };

  importPastOrFutureDebits = async (user_id: string, bank_id: string, pastOrFutureDebits: PastOrFutureDebitType[]): Promise<PastOrFutureDebitType[]> => {
    const bankAccount = await this.fetchOneBankAccount(user_id, bank_id);

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