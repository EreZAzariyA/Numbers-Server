import { UserModel } from "../models/user-model";
import ClientError from "../models/client-error";
import { SupportedCompanies, createBankErrorStatus, getBankData, insertBankAccount, isCardProviderCompany } from "../utils/bank-utils";
import { ErrorMessages, getFutureDebitDate, isArrayAndNotEmpty } from "../utils/helpers";
import { PastOrFutureDebitType, Transaction, TransactionsAccount } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import jwt from "../utils/jwt";
import categoriesLogic from "./categories";
import { ITransactionModel, Transactions } from "../collections/Transactions";
import transactionsLogic from "./transactions";
import { IBankModal } from "../models/bank-model";
import { CardTransactions, ICardTransactionModel } from "../collections/Card-Transactions";
import { ICategoryModel } from "../models/category-model";
import { Accounts, IAccountModel } from "../collections/Banks";

interface RefreshedBankAccountDetails {
  bank: IBankModal; // full inserted bank - no account.txns or cardsBlock.txns
  account: TransactionsAccount; // scrapper account - account.txns + cardsBlock.txns
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
  fetchMainAccount = async (user_id: string, query = {}): Promise<IAccountModel | null> => {
    return Accounts.findOne({ user_id, ...query }).exec();
  };

  fetchOneBankAccount = async (user_id: string, bank_id: string): Promise<IBankModal> => {
    const mainAccount = await this.fetchMainAccount(user_id);
    return mainAccount?.banks?.find((bank) => bank._id?.toString() === bank_id);
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
      try {
        await createBankErrorStatus(user._id?.toString(), details.companyId, scrapeResult.errorMessage)
      } catch (error) {
        console.log(`Error while trying to create error sub-document: ${JSON.stringify(error)}`);
      }
      console.error(`Scraper error on 'BankLogic/fetchBankData' ${scrapeResult?.errorType ? `- ${scrapeResult.errorType}` : ''}: ${scrapeResult.errorMessage} for user ${user_id}.`);
      throw new ClientError(500, ErrorMessages.SOME_ERROR_TRY_AGAIN);
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
  ): Promise<Partial<RefreshedBankAccountDetails>> => {
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

    if (account?.txns && isArrayAndNotEmpty(account.txns)) {
      try {
        const transactions = await this.importTransactions(account.txns, user_id, details.companyId);
        insertedTransactions = [...insertedTransactions, ...transactions];
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }

    if (account?.cardsPastOrFutureDebit && isArrayAndNotEmpty(account.cardsPastOrFutureDebit?.cardsBlock)) {
      const promises = account.cardsPastOrFutureDebit.cardsBlock
        .filter((card) => isArrayAndNotEmpty(card.txns))
        .map(async (card) => {
          if (card.cardStatusCode && card.cardStatusCode === 9) return;
          try {
            const cardTransactions = await this.importTransactions(card.txns, user_id, details.companyId);
            insertedTransactions = [...insertedTransactions, ...cardTransactions];
          } catch (error) {
            throw new ClientError(500, error?.message || error);
          }
        });

      await Promise.all(promises);
    }

    if (account?.pastOrFutureDebits && isArrayAndNotEmpty(account?.pastOrFutureDebits)) {
      try {
        const updatedPastOrFutureDebits = await this.importPastOrFutureDebits(
          user_id,
          bank_id,
          account.pastOrFutureDebits
        );
        updatedPastOrFutureDebits.sort((a, b) => (getFutureDebitDate(a.debitMonth) - getFutureDebitDate(b.debitMonth)));
        account.pastOrFutureDebits = updatedPastOrFutureDebits;
      } catch (err: any) {
        throw new ClientError(500, err.message);
      }
    }

    try {
      const bank = await insertBankAccount(user_id, details, account);
      return {
        bank,
        importedTransactions: insertedTransactions,
        // todo: add importedCategories
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
    if (credentials) {
      const decodedCredentials = await jwt.fetchBankCredentialsFromToken(credentials);
      if (!decodedCredentials) {
        throw new ClientError(500, ErrorMessages.DECODED_CREDENTIALS_NOT_LOADED);
      }

      const oldCredentials = [];
      oldCredentials.push(decodedCredentials);
    }

    const newDetailsCredentials = jwt.createNewToken(newDetails);
    const refreshedBankData = await this.refreshBankData(bank_id, user_id, newDetailsCredentials);
    return refreshedBankData;
  };

  importTransactions = async (
    transactions: Transaction[],
    user_id: string,
    companyId: string,
  ): Promise<(ITransactionModel | ICardTransactionModel)[]> => {
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
    let inserted: (ITransactionModel | ICardTransactionModel)[] = [];

    for (const originalTransaction of transactions) {
      const {
        status,
        date,
        originalAmount,
        chargedAmount,
        description,
        categoryDescription,
        category,
        identifier,
        cardNumber,
      } = originalTransaction;
      if (!identifier) continue;

      const existedTransaction = await transactionsLogic
        .fetchUserBankTransaction(originalTransaction, companyId, user_id);
      if (existedTransaction) {
        if (existedTransaction.status?.toLowerCase() !== status?.toLowerCase()) {
          try {
            const trans = await transactionsLogic.updateTransactionStatus(existedTransaction, status);
            inserted.push(trans);
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

      const transaction = {
        user_id,
        date,
        description,
        companyId,
        status,
        identifier,
        amount: originalAmount || chargedAmount,
        category_id: originalTransactionCategory._id,
      };
      if (isCardTransactions) {
        const transToInsert = new CardTransactions({
          ...transaction,
          ...originalTransaction,
          cardNumber
        });
        cardsTransactionsToInsert.push(transToInsert);
      } else {
        const transToInsert = new Transactions(transaction);
        transactionsToInsert.push(transToInsert);
      }
    }

    try {
      if (isCardTransactions) {
        const insertedCardsTrans = await CardTransactions.insertMany(cardsTransactionsToInsert, {
          ordered: false,
          throwOnValidationError: false,
        });
        inserted = [...inserted, ...insertedCardsTrans];
      } else {
        const insertedTrans = await Transactions.insertMany(transactionsToInsert, {
          ordered: false,
          throwOnValidationError: false,
        });
        inserted = [...inserted, ...insertedTrans];
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
    pastOrFutureDebits: PastOrFutureDebitType[] = []
  ): Promise<PastOrFutureDebitType[]> => {
    const bankAccount = await this.fetchOneBankAccount(user_id, bank_id);
    const bankPastOrFutureDebits = bankAccount.pastOrFutureDebits || [];

    pastOrFutureDebits.forEach((debit) => {
      if (!bankPastOrFutureDebits.find((d) => d.debitMonth === debit.debitMonth)) {
        bankPastOrFutureDebits.push(debit);
      }
    });

    return bankPastOrFutureDebits;
  };

  setMainBankAccount = async (user_id: string, bank_id: string): Promise<void> => {
    try {
      const bankAccount = await this.fetchMainAccount(user_id, { 'banks._id': bank_id });
      const banks = bankAccount.banks.map((bank) => {
        if (bank._id.toString() === bank_id.toString()) {
          bank.isMainAccount = true;
        } else {
          bank.isMainAccount = false;
        }
        return bank;
      });
      await Accounts.findOneAndUpdate(
        { user_id: bankAccount.user_id },
        { $set: { banks } }
      ).exec();
    } catch (err: any) {
      throw new ClientError(500, `Error saving the document: ${err}`)
    }
  };

  removeBankAccount = async (user_id: string, bank_id: string): Promise<void> => {
    const bankAccount = await this.fetchOneBankAccount(user_id, bank_id);
    if (!bankAccount) {
      throw new ClientError(500, ErrorMessages.USER_BANK_ACCOUNT_NOT_FOUND);
    }
    await Accounts.findOneAndUpdate({ user_id }, {
      $pull: {
        banks: { _id: bankAccount._id }
      }
    }).exec();
  };
};

const bankLogic = new BankLogic();
export default bankLogic;