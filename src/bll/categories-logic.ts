import ClientError from "../models/client-error";
import { CategoryModel, ICategoryModel } from "../models/category-model";

class CategoriesLogic {
  async fetchCategoriesByUserId (user_id: string): Promise<ICategoryModel[]> {
    return CategoryModel.find({user_id: user_id}).exec();
  };

  async addNewCategory (category: ICategoryModel, user_id: string):Promise<ICategoryModel> {
    if (!user_id) {
      throw new ClientError(500, 'User id is missing');
    }

    const newCategory = new CategoryModel({
      user_id: user_id,
      name: category.name,
      expectedSpent: category.expectedSpent
    });
    const errors = newCategory.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }
    return newCategory.save();
  };

  async updateCategory (category: ICategoryModel, user_id: string){
    const updatedCategory = await CategoryModel.findOneAndUpdate(
      { _id: category._id, user_id },
      { $set: { ...category } },
      { new: true }
    ).exec();

    const errors = updatedCategory.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }
    return updatedCategory.save();
  };

  async removeCategory (category_id: string): Promise<void> {
    await CategoryModel.findByIdAndDelete(category_id).exec();
    return;
  };
};

const categoriesLogic = new CategoriesLogic();
export default categoriesLogic;