import { UserModel } from "../models/user-model";
import ClientError from "../models/client-error";
import { SupportedCompanies, getBankData, insertBankAccount, isCardProviderCompany } from "../utils/bank-utils";
import { ErrorMessages, isArrayAndNotEmpty } from "../utils/helpers";
import { PastOrFutureDebitType, Transaction, TransactionsAccount } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import jwt from "../utils/jwt";
import categoriesLogic from "./categories";
import { ITransactionModel, Transactions } from "../collections/Transactions";
import transactionsLogic from "./transactions";
import { IBanksModal, Banks } from "../collections/Banks";
import { IAccountModal } from "../models/bank-model";
import { CardTransactions, ICardTransactionModel } from "../collections/Card-Transactions";
import { ICategoryModel } from "../models/category-model";

interface RefreshedBankAccountDetails {
  bank: IAccountModal;
  account: TransactionsAccount;
  importedTransactions?: ITransactionModel[];
  importedCategories?: ICategoryModel[];
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
  fetchBanksAccounts = async (user_id: string, query = {}): Promise<IBanksModal | null> => {
    return Banks.findOne({ user_id, ...query }).exec();
  };

  fetchOneBankAccount = async (user_id: string, bank_id: string): Promise<IAccountModal> => {
    const banksAccount = await this.fetchBanksAccounts(user_id);
    return banksAccount?.banks?.find((bank) => bank._id?.toString() === bank_id);
  };

  fetchBankData = async (
    details: UserBankCredentialModel,
    user_id: string
  ): Promise<RefreshedBankAccountDetails> => {
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
        account,
        bank
      };
    } catch (err: any) {
      console.log(err);
      throw new ClientError(500, 'Error');
    }
  };

  refreshBankData = async (
  bank_id: string,
  user_id: string,
  newDetailsCredentials?: string
  ): Promise<RefreshedBankAccountDetails> => {
    const bankAccount = await bankLogic.fetchOneBankAccount(user_id, bank_id);
    if (!bankAccount) {
      throw new ClientError(500, 'Some error while trying to find user with this account. Please contact us');
    }

    const credentials = newDetailsCredentials ? newDetailsCredentials : bankAccount?.credentials;
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

    let insertedTransactions = [];
    if (account.txns && isArrayAndNotEmpty(account.txns)) {
      try {
        insertedTransactions = await this.importTransactions(account.txns, user_id, details.companyId);
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }
    if (isArrayAndNotEmpty(account?.pastOrFutureDebits)) {
      try {
        await this.importPastOrFutureDebits(user_id, bank_id, account.pastOrFutureDebits);
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
        importedTransactions: insertedTransactions,
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

  importTransactions = async (
    transactions: Transaction[],
    user_id: string,
    companyId: string,
  ): Promise<ITransactionModel[] | ICardTransactionModel[]> => {
    let defCategory = await categoriesLogic.fetchUserCategory(user_id, 'Others');
    if (!defCategory) {
      try {
        defCategory = await categoriesLogic.addNewCategory('Others', user_id);
      } catch (err: any) {
        throw new Error(`[bankLogic/importTransactions]: Some error while trying to add default category - ${err?.message}` );
      }
    }

    const isCardTransactions = isCardProviderCompany(companyId);
    const transactionsToInsert: ITransactionModel[] = [];
    const cardsTransactionsToInsert: ICardTransactionModel[] = [];

    for (const originalTransaction of transactions) {
      const {
        status,
        date,
        originalAmount,
        chargedAmount,
        description,
        categoryDescription,
        category,
        cardNumber: transCardNumber,
      } = originalTransaction;

      const existedTransaction = await transactionsLogic.fetchUserBankTransaction(originalTransaction, companyId);
      if (existedTransaction) {
        if (existedTransaction.status?.toLowerCase() !== originalTransaction.status?.toLowerCase()) {
          try {
            await transactionsLogic.updateTransactionStatus(existedTransaction, status);
          } catch (err: any) {
            console.log(`Some error while trying to update transaction ${existedTransaction.identifier} - ${err?.message}`);
            throw new ClientError(500, `Some error while trying to update transaction ${existedTransaction.identifier}`);
          }
        }
        continue;
      }

      const originalCategory = category ?? categoryDescription;
      let originalTransactionCategory = await categoriesLogic.fetchUserCategory(user_id, originalCategory);
      if (!originalTransactionCategory?._id) {
        if (category ?? categoryDescription) {
          originalTransactionCategory = await categoriesLogic.addNewCategory(category ?? categoryDescription, user_id);
        } else {
          originalTransactionCategory = defCategory;
        }
      }

      const identifier = originalTransaction.identifier ?? undefined;

      let transaction: ITransactionModel | ICardTransactionModel = null;
      if (isCardTransactions) {
        transaction = new CardTransactions({
          user_id,
          cardNumber: transCardNumber,
          date,
          identifier,
          description,
          companyId,
          status,
          amount: originalAmount || chargedAmount,
          category_id: originalTransactionCategory._id,
        });
        cardsTransactionsToInsert.push(transaction);
      } else {
        transaction = new Transactions({
          user_id,
          date,
          identifier,
          description,
          companyId,
          status,
          amount: originalAmount || chargedAmount,
          category_id: originalTransactionCategory._id
        });
        transactionsToInsert.push(transaction);
      }
    }

    let inserted: ITransactionModel[] | ICardTransactionModel[] = [];
    try {
      if (isCardTransactions) {
        inserted = await CardTransactions.insertMany(cardsTransactionsToInsert, {
          ordered: false,
          throwOnValidationError: false,
        });
      } else {
        inserted = await Transactions.insertMany(transactionsToInsert,
          { ordered: false,
            throwOnValidationError: false,
          });
      }

      return inserted;
    } catch (err: any) {
      console.log({ ['bankLogic/importTransactions']: err?.message, inserted });
      throw new ClientError(500, 'An error occurred while importing transactions');
    }
  };

  importPastOrFutureDebits = async (
    user_id: string,
    bank_id: string,
    pastOrFutureDebits: PastOrFutureDebitType[]
  ): Promise<PastOrFutureDebitType[]> => {
    const bankAccount = await this.fetchOneBankAccount(user_id, bank_id);

    const bankPastOrFutureDebits = bankAccount?.pastOrFutureDebits || [];
    pastOrFutureDebits.forEach((debit) => {
      if (bankPastOrFutureDebits.filter((d) => d.debitMonth === debit.debitMonth).length === 0) {
        bankAccount[0].pastOrFutureDebits.push(debit);
      }
    });
    return bankPastOrFutureDebits;
  };

  setMainBankAccount = async (user_id: string, bank_id: string): Promise<void> => {
    try {
      const bankAccount = await this.fetchBanksAccounts(user_id, { 'banks._id': bank_id });
      const banks = bankAccount.banks.map((bank) => {
        if (bank._id.toString() === bank_id.toString()) {
          bank.isMainAccount = true;
        } else {
          bank.isMainAccount = false;
        }
        return bank;
      });
      await Banks.findOneAndUpdate(
        { user_id: bankAccount.user_id },
        { $set: { banks } }
      ).exec();
    } catch (err: any) {
      throw new ClientError(500, `Error saving the document: ${err}`)
    }
  };
};

const bankLogic = new BankLogic();
export default bankLogic;