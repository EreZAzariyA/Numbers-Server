import { Transaction, TransactionStatuses } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import ClientError from "../models/client-error";
import { ITransactionModel, Transactions } from "../collections/Transactions";
import { CardTransactions, ICardTransactionModel } from "../collections/Card-Transactions";
import { isCardProviderCompany } from "../utils/bank-utils";
import { Model } from "mongoose";

type MainTransactionType = ITransactionModel | ICardTransactionModel;
export type TransactionParams = {
  query: object;
  projection: object;
  options: object;
};

export const getTotalTransactionsAmounts = (transactions: MainTransactionType[]): number => {
  return transactions.reduce((acc, t) => acc + t.amount, 0);
}

class TransactionsLogic {
  fetchUserTransactions = async (
    user_id: string,
    params: Partial<TransactionParams>,
    type?: string,
  ): Promise<{ transactions: (MainTransactionType)[], total: number }> => {
    const { query, projection, options } = params;
    const collection: Model<MainTransactionType> = type === 'creditCards' ? CardTransactions : Transactions;

    let transactions = [];
    let total: number = 0;

      total = await collection.countDocuments({ user_id, ...query });
      transactions = await collection.find({ user_id, ...query }, projection, { ...options, sort: { 'date': -1 } });

    return {
      transactions,
      total
    };
  };

  fetchUserBankTransaction = async (
    transaction: Transaction,
    companyId: string,
    user_id: string
  ): Promise<MainTransactionType> => {
    const isCardTransaction = isCardProviderCompany(companyId);
    let trans: MainTransactionType = undefined;
    const query: object = {
      ...(transaction?.identifier ? {
          identifier: isCardTransaction ? transaction.identifier.toString() : transaction.identifier
        } : {
          ...(transaction?.memo ? {
            memo: transaction.memo
          } : {}),
          ...(transaction?.date ? {
            date: transaction.date
          } : {}),
          companyId,
          description: transaction.description,
          amount: transaction.chargedAmount || transaction.originalAmount,
        }),
    };

    let collection: Model<MainTransactionType> = Transactions;
    if (isCardTransaction) {
      collection = CardTransactions;
    }

    trans = await collection.findOne({ user_id, ...query }).exec();
    return trans;
  };

  newTransaction = async (
    user_id: string,
    transaction: MainTransactionType,
    type?: string
  ): Promise<MainTransactionType> => {
    if (!user_id) {
      throw new ClientError(500, 'User id is missing');
    }
    const isCardTransaction = isCardProviderCompany(transaction.companyId) || type !== 'transactions';
    let newTransaction: MainTransactionType = null;

    if (isCardTransaction) {
      newTransaction = new CardTransactions({
        user_id,
        cardNumber: transaction?.cardNumber || null,
        ...transaction
      });
    } else {
      newTransaction = new Transactions({
        user_id,
        ...transaction
      });
    }

    const errors = newTransaction.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    return newTransaction.save();
  };

  updateTransaction = async (user_id: string, transaction: MainTransactionType, type: string = 'Account'): Promise<MainTransactionType> => {
    const isCardTransaction = type !== 'transactions';
    const collection: Model<MainTransactionType> = isCardTransaction ? CardTransactions : Transactions;

    const currentTransaction = await collection.findOne({ user_id, _id: transaction._id }).exec();
    if (!currentTransaction) {
      throw new ClientError(400, 'User transaction not found');
    }

    const updatedTransaction = await collection.findOneAndUpdate({ user_id, _id: transaction._id }, {
      $set: {
        ...transaction,
        date: transaction.date,
        category_id: transaction.category_id,
        description: transaction.description,
        amount: transaction.amount,
        status: transaction.status || TransactionStatuses.Completed,
      }
    }, { new: true }).exec();

    const errors = updatedTransaction.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    return updatedTransaction;
  };

  updateTransactionStatus = async (
    transaction: MainTransactionType,
    status: string
  ): Promise<MainTransactionType> => {
    const isCardProvider = isCardProviderCompany(transaction.companyId);
    const query = {
      _id: transaction._id,
      query: { $set: { status } },
      projection: { new: true }
    };
    if (isCardProvider) {
      return await CardTransactions.findByIdAndUpdate(query).exec();
    }
    return await Transactions.findByIdAndUpdate(query).exec();
  };

  removeTransaction = async (user_id: string, transaction_id: string, type: string = 'transactions'): Promise<void> => {
    const isCardTransaction = type !== 'transactions';
    const query = { user_id, _id: transaction_id };
    try {
      if (isCardTransaction) {
        await CardTransactions.findOneAndDelete(query).exec();
      }
      await Transactions.findByIdAndDelete(query).exec();
    } catch (err: any) {
      console.log(err);
    }
  };
};

const transactionsLogic = new TransactionsLogic();
export default transactionsLogic;