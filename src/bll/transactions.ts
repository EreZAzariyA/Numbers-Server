import { Transaction, TransactionStatuses } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import ClientError from "../models/client-error";
import { ITransactionModel, Transactions } from "../collections/Transactions";

class TransactionsLogic {
  fetchUserTransactions = async (user_id: string, query = {}): Promise<ITransactionModel[]> => {
    return Transactions.find({ user_id, ...query }).exec();
  };

  fetchUserBankTransaction = async (user_id: string, transaction: Transaction): Promise<ITransactionModel> => {
    const trans = Transactions.findOne({
      user_id,
      status: transaction.status,
      description: transaction.description,
      identifier: transaction.identifier
    }).exec();
    return trans;
  };

  newTransaction = async (user_id: string, transaction: ITransactionModel):Promise<ITransactionModel> => {
    if (!user_id) {
      throw new ClientError(500, 'User id is missing');
    }

    const newTransaction = new Transactions({
      user_id,
      ...transaction
    });

    const errors = newTransaction.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    return newTransaction.save();
  };

  updateTransaction = async (transaction: ITransactionModel): Promise<ITransactionModel> => {
    const updatedTransaction = await Transactions.findByIdAndUpdate(transaction._id, {
      $set: {
        date: transaction.date,
        category_id: transaction.category_id,
        description: transaction.description,
        amount: transaction.amount,
        status: transaction.status || TransactionStatuses.Completed
      }
    }, { new: true }).exec();

    if (!updatedTransaction) {
      throw new ClientError(404, 'Transaction not found');
    }

    const errors = updatedTransaction.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    return updatedTransaction;
  };

  updateTransactionStatus = async (transaction: ITransactionModel, status: string): Promise<ITransactionModel> => {
    return await Transactions.findByIdAndUpdate(
      transaction._id,
      { $set: { status } },
      { new: true }
    ).exec();

  };

  removeTransaction = async (transaction_id: string): Promise<void> => {
    await Transactions.findByIdAndDelete(transaction_id).exec();
  };
};

const transactionsLogic = new TransactionsLogic();
export default transactionsLogic;