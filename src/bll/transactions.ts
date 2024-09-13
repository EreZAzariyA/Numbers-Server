import { Transaction, TransactionStatuses } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import ClientError from "../models/client-error";
import { ITransactionModel, Transactions } from "../collections/Transactions";
import categoriesLogic, { getAmountToUpdate } from "./categories";

class TransactionsLogic {
  fetchUserTransactions = async (user_id: string, query = {}): Promise<ITransactionModel[]> => {
    return Transactions.find({ user_id, ...query }).exec();
  };

  fetchUserBankTransaction = async (user_id: string, transaction: Transaction): Promise<ITransactionModel> => {
    const trans = Transactions.findOne({
      user_id,
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

    try {
      await categoriesLogic.updateCategorySpentAmount(
        user_id,
        newTransaction.category_id,
        newTransaction.amount
      );
    } catch (err: any) {
      console.log(err);
      throw new ClientError(500, 'Some error while trying to increment the category spent amount');
    }

    const errors = newTransaction.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    return newTransaction.save();
  };

  updateTransaction = async (transaction: ITransactionModel): Promise<ITransactionModel> => {
    const currentTransaction = await Transactions.findById(transaction._id).exec();
    const currentTransactionAmountToDecrement = getAmountToUpdate(currentTransaction.amount);

    const updatedTransaction = await Transactions.findByIdAndUpdate(transaction._id, {
      $set: {
        date: transaction.date,
        category_id: transaction.category_id,
        description: transaction.description,
        amount: transaction.amount,
        status: transaction.status || TransactionStatuses.Completed
      }
    }, { new: true }).exec();

    try {
      await categoriesLogic.updateCategorySpentAmount(
        currentTransaction.user_id,
        currentTransaction.category_id,
        currentTransactionAmountToDecrement,
        updatedTransaction.amount,
      );
    } catch (err: any) {
      console.log(err);
    }

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
    const transactionToRemove = await Transactions.findById(transaction_id).exec();
    const amountToUpdate = getAmountToUpdate(transactionToRemove.amount);

    try {
      await Transactions.findByIdAndDelete(transaction_id).exec();
      await categoriesLogic.updateCategorySpentAmount(
        transactionToRemove.user_id,
        transactionToRemove.category_id,
        amountToUpdate
      );
    } catch (err: any) {
      console.log(err);
    }
  };
};

const transactionsLogic = new TransactionsLogic();
export default transactionsLogic;