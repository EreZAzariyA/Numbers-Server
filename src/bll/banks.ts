import { CardBlockType, PastOrFutureDebitType, Transaction, TransactionsAccount } from "israeli-bank-scrapers-for-e.a-servers/lib/transactions";
import { categoriesLogic, transactionsLogic } from ".";
import { CardTransactions, Accounts, Transactions } from "../collections";
import { ClientError, UserModel, IBankModal, ITransactionModel, ICategoryModel, IAccountModel, ICardTransactionModel } from "../models";
import { ErrorMessages, getFutureDebitDate, isArrayAndNotEmpty, isCardProviderCompany, SupportedCompanies, UserBankCredentials } from "../utils/helpers";
import { decryptBankCredentials, encryptBankCredentials } from "../utils/bank-credentials";
import { getBankData, insertBankAccount } from "../utils/bank-utils";
import { invalidateUserDerivedCaches } from "./transactions";
import config from "../utils/config";
import { isRedisAvailable } from "../utils/connectRedis";
import {
  getCardLast4,
  getEventDate,
  getPostingDate,
  getProviderCategoryName,
} from "../utils/transaction-semantics";
import { inferSemanticType } from "../utils/semantic-type";

type ImportedBankTransaction = Transaction & {
  billingDate?: string;
  providerCategoryId?: string | number;
  providerCategoryName?: string;
  merchantId?: string;
  mcc?: string | number;
  counterparty?: string;
  cardUniqueId?: string;
  cardLast4?: string | number;
  semanticType?: string;
};

interface RefreshedBankAccountDetails {
  bank: IBankModal; // full inserted bank - no account.txns or cardsBlock.txns
  account: TransactionsAccount; // scrapper account - account.txns + cardsBlock.txns
  importedTransactions?: Array<ITransactionModel | ICardTransactionModel>;
  importedCategories?: ICategoryModel[];
};

type CardBlockWithTransactions = CardBlockType & {
  txns: ImportedBankTransaction[];
};

interface MainAccountResponse {
  _id?: string;
  user_id: string;
  banks: IBankModal[];
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : ErrorMessages.SOME_ERROR_TRY_AGAIN;
};

const isSupportedCompany = (companyId: string): boolean =>
  Object.prototype.hasOwnProperty.call(SupportedCompanies, companyId);

const hasTransactions = (card: CardBlockType): card is CardBlockWithTransactions => {
  return Boolean(card?.txns && isArrayAndNotEmpty(card.txns));
};

class BankLogic {
  fetchMainAccount = async (user_id: string, query = {}): Promise<IAccountModel | null> => {
    return Accounts.findOne({ user_id, ...query }).exec();
  };

  fetchMainAccountResponse = async (user_id: string): Promise<MainAccountResponse> => {
    const mainAccount = await this.fetchMainAccount(user_id);

    return {
      ...(mainAccount?._id && { _id: mainAccount._id.toString() }),
      user_id: mainAccount?.user_id?.toString() ?? user_id,
      banks: mainAccount?.banks ?? [],
    };
  };

  fetchOneBankAccount = async (user_id: string, bank_id: string): Promise<IBankModal | undefined> => {
    const mainAccount = await this.fetchMainAccount(user_id);
    return mainAccount?.banks?.find((bank) => bank._id?.toString() === bank_id);
  };

  fetchBankData = async (
    details: UserBankCredentials,
    user_id: string
  ): Promise<RefreshedBankAccountDetails> => {
    const user = await UserModel.findById(user_id).exec();
    if (!user) {
      throw new ClientError(500, ErrorMessages.USER_NOT_FOUND);
    }

    if (!isSupportedCompany(details.companyId)) {
      throw new ClientError(500, `${ErrorMessages.COMPANY_NOT_SUPPORTED} - ${details.companyId}`);
    }

    const scrapeResult = await getBankData(details);
    if (scrapeResult.errorType || scrapeResult.errorMessage) {
      console.error(`Scraper error on 'BankLogic/fetchBankData': ${scrapeResult.errorMessage}.`);
      throw new ClientError(500, ErrorMessages.SOME_ERROR_TRY_AGAIN);
    }

    try {
      const account = scrapeResult.accounts?.[0];
      if (!account) {
        throw new ClientError(500, 'No account data returned from bank scraper');
      }
      const bank = await insertBankAccount(user_id, details, account);
      return {
        account,
        bank
      };
    } catch (err) {
      console.log(err);
      throw new ClientError(500, getErrorMessage(err));
    }
  };

  refreshBankData = async (
  bank_id: string,
  user_id: string,
  newDetailsCredentials?: string
  ): Promise<Partial<RefreshedBankAccountDetails>> => {
    const bankAccount = await this.fetchOneBankAccount(user_id, bank_id);
    if (!bankAccount) {
      throw new ClientError(500, 'Some error while trying to find user with this account. Please contact us');
    }

    const credentials = newDetailsCredentials ? newDetailsCredentials : bankAccount?.credentials;
    if (!credentials) {
      throw new ClientError(500, 'Some error while trying to load saved credentials. Please contact us');
    }

    const decodedCredentials = decryptBankCredentials(credentials);
    if (!decodedCredentials) {
      throw new ClientError(500, 'Some error while trying to load decoded credentials. Please contact us');
    }

    const details: UserBankCredentials = {
      companyId: decodedCredentials.companyId,
      id: decodedCredentials.id,
      password: decodedCredentials.password,
      num: decodedCredentials.num,
      save: decodedCredentials.save,
      username: decodedCredentials.username
    };

    const scrapeResult = await getBankData(details);
    if (scrapeResult.errorType || scrapeResult.errorMessage) {
      throw new ClientError(500, getErrorMessage(scrapeResult.errorMessage));
    }

    const account = scrapeResult.accounts?.[0];
    if (!account) {
      throw new ClientError(500, 'No account data returned from bank scraper');
    }
    let insertedTransactions: Array<ITransactionModel | ICardTransactionModel> = [];

    if (account?.txns && isArrayAndNotEmpty(account.txns)) {
      try {
        const transactions = await this.importTransactions(account.txns, user_id, details.companyId);
        insertedTransactions = [...insertedTransactions, ...transactions];
      } catch (err) {
        throw new ClientError(500, getErrorMessage(err));
      }
    }

    const cardsBlocks = account.cardsPastOrFutureDebit?.cardsBlock ?? [];
    if (isArrayAndNotEmpty(cardsBlocks)) {
      const promises = cardsBlocks
        .filter(hasTransactions)
        .map(async (card) => {
          if (card.cardStatusCode && card.cardStatusCode === 9) return;
          try {
            const cardTransactions = await this.importTransactions(card.txns, user_id, details.companyId);
            insertedTransactions = [...insertedTransactions, ...cardTransactions];
          } catch (error) {
            throw new ClientError(500, getErrorMessage(error));
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
      } catch (err) {
        throw new ClientError(500, getErrorMessage(err));
      }
    }

    try {
      const bank = await insertBankAccount(user_id, details, account);
      return {
        bank,
        account,
        importedTransactions: insertedTransactions,
        // todo: add importedCategories
      };
    } catch (err) {
      throw new ClientError(500, getErrorMessage(err));
    }
  };

  updateBankAccountDetails = async (bank_id: string, user_id: string, newDetails: UserBankCredentials) => {
    const bankAccount = await this.fetchOneBankAccount(user_id, bank_id);
    if (!bankAccount) {
      throw new ClientError(500, ErrorMessages.USER_BANK_ACCOUNT_NOT_FOUND);
    }

    const credentials = bankAccount?.credentials;
    if (credentials) {
      const decodedCredentials = decryptBankCredentials(credentials);
      if (!decodedCredentials) {
        throw new ClientError(500, ErrorMessages.DECODED_CREDENTIALS_NOT_LOADED);
      }
    }

    const newDetailsCredentials = encryptBankCredentials(newDetails);
    const refreshedBankData = await this.refreshBankData(bank_id, user_id, newDetailsCredentials);
    return refreshedBankData;
  };

  importTransactions = async (
    transactions: ImportedBankTransaction[],
    user_id: string,
    companyId: string,
  ): Promise<(ITransactionModel | ICardTransactionModel)[]> => {
    let defCategory = await categoriesLogic.fetchUserCategory(user_id, 'Others');
    if (!defCategory) {
      try {
        defCategory = await categoriesLogic.addNewCategory('Others', user_id, { reuseExisting: true });
      } catch (err) {
        throw new Error(`[bankLogic/importTransactions]: Some error while trying to add default category - ${getErrorMessage(err)}` );
      }
    }

    const isCardTransactions = isCardProviderCompany(companyId);
    const transactionsToInsert: ITransactionModel[] = [];
    const cardsTransactionsToInsert: ICardTransactionModel[] = [];
    let inserted: (ITransactionModel | ICardTransactionModel)[] = [];

    for (const originalTransaction of transactions) {
      const {
        status,
        originalAmount,
        chargedAmount,
        description,
        identifier,
      } = originalTransaction;
      if (!identifier) continue;

      const existedTransaction = await transactionsLogic
        .fetchUserBankTransaction(originalTransaction, companyId, user_id);
      if (existedTransaction) {
        if (existedTransaction.status?.toLowerCase() !== status?.toLowerCase()) {
          try {
            const trans = await transactionsLogic.updateTransactionStatus(existedTransaction, status);
            inserted.push(trans);
          } catch (err) {
            console.log(`Some error while trying to update transaction ${existedTransaction.identifier} - ${getErrorMessage(err)}`);
            throw new ClientError(500, `Some error while trying to update transaction ${existedTransaction.identifier}`);
          }
        }
        continue;
      }

      const eventDate = getEventDate(originalTransaction);
      const postingDate = getPostingDate(originalTransaction);
      const providerCategoryName = getProviderCategoryName(originalTransaction);
      const originalCategory = providerCategoryName;
      let originalTransactionCategory = await categoriesLogic.fetchUserCategory(user_id, originalCategory);
      if (!originalTransactionCategory?._id) {
        if (providerCategoryName) {
          originalTransactionCategory = await categoriesLogic.addNewCategory(
            providerCategoryName,
            user_id,
            { reuseExisting: true }
          );
        } else {
          originalTransactionCategory = defCategory;
        }
      }

      const transaction = {
        user_id,
        eventDate,
        postingDate,
        billingDate: originalTransaction.billingDate,
        date: eventDate,
        processedDate: postingDate,
        description,
        companyId,
        status,
        identifier,
        amount: chargedAmount ?? originalAmount,
        category_id: originalTransactionCategory._id,
        semanticType: inferSemanticType({ ...originalTransaction, companyId }),
        providerCategoryId: originalTransaction.providerCategoryId,
        providerCategoryName,
        merchantId: originalTransaction.merchantId,
        mcc: originalTransaction.mcc,
        counterparty: originalTransaction.counterparty,
        cardUniqueId: originalTransaction.cardUniqueId,
        cardLast4: getCardLast4(originalTransaction),
      };
      if (isCardTransactions) {
        const transToInsert = new CardTransactions({
          ...originalTransaction,
          ...transaction,
          cardNumber: getCardLast4(originalTransaction) || undefined,
          cardLast4: getCardLast4(originalTransaction) || undefined,
        });
        cardsTransactionsToInsert.push(transToInsert);
      } else {
        const transToInsert = new Transactions({
          ...originalTransaction,
          ...transaction,
        });
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

      if (inserted.length > 0) {
        await invalidateUserDerivedCaches(user_id);
        if (config.enablePatternPersistence && isRedisAvailable()) {
          try {
            const { enqueuePatternRecompute } = await import('../queues');
            await enqueuePatternRecompute(user_id);
          } catch (_) { /* worker may not be available */ }
        }
      }
      return inserted;
    } catch (err: any) {
      // MongoBulkWriteError (e.g. E11000 duplicate key) — expected when re-importing existing
      // transactions. Extract successfully inserted docs and continue rather than failing the job.
      if (err?.name === 'MongoBulkWriteError') {
        inserted = [...inserted, ...(err?.insertedDocs ?? [])];
        if (inserted.length > 0) {
          await invalidateUserDerivedCaches(user_id);
          if (config.enablePatternPersistence && isRedisAvailable()) {
            try {
              const { enqueuePatternRecompute } = await import('../queues');
              await enqueuePatternRecompute(user_id);
            } catch (_) { /* worker may not be available */ }
          }
        }
        return inserted;
      }
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
    const bankPastOrFutureDebits = bankAccount?.pastOrFutureDebits || [];

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
      if (!bankAccount) {
        throw new ClientError(500, ErrorMessages.USER_BANK_ACCOUNT_NOT_FOUND);
      }

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
    } catch (err) {
      throw new ClientError(500, `Error saving the document: ${getErrorMessage(err)}`)
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
