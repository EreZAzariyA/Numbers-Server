import { CategoryModel, ICategoryModel } from "../models/category-model";
import ClientError from "../models/client-error";
import { ErrorMessages } from "../utils/helpers";
import { Categories, ICategories } from "../collections/Categories";
import { Types } from "mongoose";
import { UserModel } from "../models/user-model";
import { TransactionStatuses } from "israeli-bank-scrapers-by-e.a/lib/transactions";
import { ITransactionModel, Transactions } from "../collections/Transactions";
import { CardTransactions, ICardTransactionModel } from "../collections/Card-Transactions";
import { getTotalTransactionsAmounts } from "./transactions";

class CategoriesLogic {
  async createAccountCategories (user_id: string): Promise<ICategories> {
    console.info(`createAccountCategories: Creating categories object for user: ${user_id}`);

    const accountCategories = new Categories({
      user_id,
      categories: []
    });

    const errors = accountCategories.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    console.info(`createAccountCategories: Categories object for user: ${user_id} - Created successfully`);
    return accountCategories.save();
  };

  async fetchCategoriesByUserId (user_id: string): Promise<(ICategoryModel & {
    transactions: (ITransactionModel | ICardTransactionModel)[]
  })[]> {
    const userCategories = await Categories.findOne({ user_id }).exec();

    return await Promise.all(userCategories.categories?.map(async (category) => {
      const transactions = await Transactions.find({
        user_id,
        category_id: category._id,
        status: TransactionStatuses.Completed
      }).exec();
      const cardTransactions = await CardTransactions.find({
        user_id,
        category_id: category._id,
        status: TransactionStatuses.Completed
      }).exec();

      return {
        ...category.toObject(),
        spent: getTotalTransactionsAmounts([...transactions, ...cardTransactions]),
        transactions: [...transactions, ...cardTransactions]?.length
      }
    }));
  };

  async fetchUserCategory (user_id: string, categoryName: string): Promise<ICategoryModel> {
    try {
      const userCategories = await this.fetchCategoriesByUserId(user_id);
      const categoryIndex = userCategories.findIndex((c) => c.name === categoryName);
      const category = userCategories[categoryIndex];
      return category
    } catch (err: any) {
      console.log(err);
      return err;
    }
  };

  async addNewCategory(categoryName: string, user_id: string): Promise<ICategoryModel> {
    const user = await UserModel.findById(user_id).catch(() => {
      console.info(`addNewCategory: Fail to add category: ${categoryName} - ${ErrorMessages.USER_NOT_FOUND}`);
      throw new ClientError(400, ErrorMessages.USER_NOT_FOUND);
    });

    const allCategories = await Categories.findOne({ user_id: user._id }).exec();
    if (allCategories) {
      const isExist = allCategories.categories.some((c) => c.name === categoryName);

      if (isExist) {
        console.info(`addNewCategory: Fail to add category: ${categoryName} - ${ErrorMessages.NAME_IN_USE}`);
        throw new ClientError(500, ErrorMessages.NAME_IN_USE);
      }
    }

    const category = new CategoryModel({ name: categoryName });
    const updatedCategories = await Categories.findOneAndUpdate(
      { user_id: user._id },
      { $push: { categories: category } },
      { new: true, upsert: true }
    ).exec();

    if (!updatedCategories) {
      console.error('Failed to add category, document not found or created.');
      throw new ClientError(500, 'Failed to add category');
    }

    return category;
  };

  async updateCategorySpentAmount (
    user_id: Types.ObjectId,
    category_id: Types.ObjectId,
    amount: number,
    newAmount?: number
  ) {
    await Categories.findOneAndUpdate(
      { user_id, 'categories._id': category_id },
      { $inc: { 'categories.$.spent': amount } },
      { new: true }
    ).exec();
    if (newAmount) {
      await Categories.findOneAndUpdate(
        { user_id, 'categories._id': category_id },
        { $inc: { 'categories.$.spent': newAmount } },
        { new: true }
      ).exec();
    }
  };

  async updateCategory (category: ICategoryModel, user_id: string): Promise<ICategoryModel> {
    const updatedDoc = await Categories.findOneAndUpdate(
      { user_id, 'categories._id': category._id },
      { $set: {
        'categories.$': { ...category },
      } },
      { new: true }
    ).select('categories').exec();

    if (!updatedDoc) {
      throw new ClientError(404, 'Category not found');
    }

    const errors = updatedDoc.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }

    const updatedCategory = updatedDoc.categories.find((c) => c._id.toString() === category._id.toString());
    if (!updatedCategory) {
      throw new ClientError(404, 'Updated category not found');
    }

    return updatedCategory;
  };

  async removeCategory (category_id: string, user_id: string): Promise<void> {
    await Categories.findOneAndUpdate(
      { user_id },
      { $pull: { categories: { _id: category_id } } },
      { new: true }
    ).exec();
  };
};

const categoriesLogic = new CategoriesLogic();
export default categoriesLogic;