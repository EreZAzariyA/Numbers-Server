import { CategoryModel, ICategoryModel } from "../models/category-model";
import ClientError from "../models/client-error";
import { ErrorMessages } from "../utils/helpers";
import { Categories, ICategories } from "../collections/Categories";
import { Types } from "mongoose";

export const getAmountToUpdate = (amount: number) => {
  let newAmount = 0;
  if (amount > 0) {
    newAmount = amount * -1;
  } else {
    newAmount = Math.abs(amount);
  }

  return newAmount;
}

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

  async fetchCategoriesByUserId (user_id: string): Promise<ICategoryModel[]> {
    const userCategories = await Categories.findOne({ user_id }).exec();
    return userCategories?.categories || [];
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
    if (!user_id) {
      console.info(`addNewCategory: Fail to add category: ${categoryName} - ${ErrorMessages.USER_ID_MISSING}`);
      throw new ClientError(500, ErrorMessages.USER_ID_MISSING);
    }

    const allCategories = await Categories.findOne({ user_id }).exec();
    if (allCategories) {
      const isExist = allCategories.categories.some((c) => c.name === categoryName);

      if (isExist) {
        console.info(`addNewCategory: Fail to add category: ${categoryName} - ${ErrorMessages.NAME_IN_USE}`);
        throw new ClientError(500, ErrorMessages.NAME_IN_USE);
      }
    }

    const category = new CategoryModel({ name: categoryName });
    const updatedCategories = await Categories.findOneAndUpdate(
      { user_id },
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

  async updateManyCategoriesSpentAmount (user_id: string, categoriesSpentObj: object): Promise<void> {
    for (const [categoryName, spentAmount] of Object.entries(categoriesSpentObj)) {
      await Categories.findOneAndUpdate(
        { user_id, 'categories.name': categoryName },
        { $inc: { 'categories.$.spent': spentAmount } }
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