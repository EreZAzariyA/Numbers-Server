import ClientError from "../models/client-error";
import { CategoryModel, ICategoryModel } from "../models/category-model";

class CategoriesLogic {
  async fetchCategoriesByUserId (user_id: string): Promise<ICategoryModel[]> {
    return CategoryModel.find({user_id: user_id}).exec();
  };

  async addNewCategory (category: ICategoryModel):Promise<ICategoryModel> {
    if (!category.user_id) {
      throw new ClientError(500, 'User id is missing');
    }

    const newCategory = new CategoryModel({
      user_id: category.user_id,
      name: category.name,
    });
    const errors = newCategory.validateSync();
    if (errors) {
      throw new ClientError(500, errors.message);
    }
    return newCategory.save();
  };

  async updateCategory (category: ICategoryModel){
    const updatedCategory = await CategoryModel.findByIdAndUpdate(category._id, {
      $set: { ...category }
    }, { new: true }).exec();

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